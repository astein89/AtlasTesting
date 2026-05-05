import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import Papa from 'papaparse'
import { db } from '../db/index.js'
import {
  authMiddleware,
  requirePermission,
  requireAnyPermission,
  type AuthRequest,
} from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import { roleHasPermission } from '../lib/permissionsCatalog.js'
import {
  getAmrFleetConfig,
  saveAmrFleetConfig,
  publicAmrFleetConfig,
  type AmrFleetConfig,
} from '../lib/amrConfig.js'
import { fleetJsonIndicatesSuccess, forwardAmrFleetRequest } from '../lib/amrFleet.js'
import {
  buildSegmentMissionData,
  continueNotBeforeDeferredFirstSegment,
  continueNotBeforeForAwaitingSession,
  normalizeDestinationInput,
  normalizePickupContinueInput,
  parseMultistopPlan,
  shouldDeferFirstSegmentSubmit,
  type MultistopPlan,
} from '../lib/amrMultistop.js'
import { executeMultistopContinue, multistopSegmentMissionCode } from '../lib/amrMultistopContinue.js'
import { rescheduleAmrMissionWorker } from '../lib/amrMissionWorker.js'

const router = Router()

const FLEET_MUTATION_OPS = new Set([
  'submitMission',
  'containerIn',
  'containerOut',
  'missionCancel',
  'operationFeedback',
])

function nowTs(): string {
  return new Date().toISOString()
}

function genDCA(kind: string): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const r = uuidv4().replace(/-/g, '').slice(0, 8)
  return `DCA-${kind}-${y}${m}${day}-${r}`
}

/** Empty / whitespace DWG → null so uniqueness applies only to real drawing refs. */
function normalizeDwgRef(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

async function standIdWithExternalRef(externalRef: string, excludeId?: string): Promise<string | undefined> {
  const row = excludeId
    ? ((await db.prepare('SELECT id FROM amr_stands WHERE external_ref = ? AND id != ?').get(externalRef, excludeId)) as
        | { id: string }
        | undefined)
    : ((await db.prepare('SELECT id FROM amr_stands WHERE external_ref = ?').get(externalRef)) as { id: string } | undefined)
  return row?.id
}

async function standIdWithDwgRef(dwg: string | null, excludeId?: string): Promise<string | undefined> {
  if (!dwg) return undefined
  const row = excludeId
    ? ((await db.prepare('SELECT id FROM amr_stands WHERE dwg_ref = ? AND id != ?').get(dwg, excludeId)) as
        | { id: string }
        | undefined)
    : ((await db.prepare('SELECT id FROM amr_stands WHERE dwg_ref = ?').get(dwg)) as { id: string } | undefined)
  return row?.id
}

router.get(
  '/dc/settings',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const cfg = await getAmrFleetConfig(db)
    res.json(publicAmrFleetConfig(cfg))
  })
)

router.put(
  '/dc/settings',
  authMiddleware,
  requirePermission('amr.settings'),
  asyncRoute(async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>
    const patch: Partial<AmrFleetConfig> & { authKey?: string } = {}
    if (typeof body.serverIp === 'string') patch.serverIp = body.serverIp
    if (typeof body.serverPort === 'number') patch.serverPort = body.serverPort
    if (typeof body.useHttps === 'boolean') patch.useHttps = body.useHttps
    if (typeof body.orgId === 'string') patch.orgId = body.orgId
    if (typeof body.robotType === 'string') patch.robotType = body.robotType
    if (Array.isArray(body.robotModels))
      patch.robotModels = body.robotModels.filter((x): x is string => typeof x === 'string')
    if (Array.isArray(body.robotIdsDefault))
      patch.robotIdsDefault = body.robotIdsDefault.filter((x): x is string => typeof x === 'string')
    if (typeof body.containerType === 'string') patch.containerType = body.containerType
    if (typeof body.containerModelCode === 'string') patch.containerModelCode = body.containerModelCode
    if (typeof body.pollMsMissions === 'number') patch.pollMsMissions = body.pollMsMissions
    if (typeof body.pollMsMissionWorker === 'number') patch.pollMsMissionWorker = body.pollMsMissionWorker
    if (typeof body.pollMsRobots === 'number') patch.pollMsRobots = body.pollMsRobots
    if (typeof body.pollMsContainers === 'number') patch.pollMsContainers = body.pollMsContainers
    if ('hideFleetCompleteAfterMinutesDefault' in body) {
      const h = body.hideFleetCompleteAfterMinutesDefault
      if (h === null) patch.hideFleetCompleteAfterMinutesDefault = null
      else if (typeof h === 'number' && h > 0 && Number.isFinite(h)) patch.hideFleetCompleteAfterMinutesDefault = h
    }
    if (typeof body.authKey === 'string') patch.authKey = body.authKey

    const next = await saveAmrFleetConfig(db, patch)
    rescheduleAmrMissionWorker()
    res.json(publicAmrFleetConfig(next))
  })
)

router.post(
  '/dc/fleet/test',
  authMiddleware,
  requireAnyPermission('amr.settings', 'module.amr'),
  asyncRoute(async (req: AuthRequest, res) => {
    const cfg = await getAmrFleetConfig(db)
    const fr = await forwardAmrFleetRequest(cfg, 'robotQuery', { robotId: '', robotType: '' }, {
      db,
      source: 'fleet-test',
      userId: req.user!.id,
    })
    res.status(fr.status).json(fr.json)
  })
)

router.post(
  '/dc/fleet',
  authMiddleware,
  asyncRoute(async (req: AuthRequest, res) => {
    const operation = typeof req.body?.operation === 'string' ? req.body.operation.trim() : ''
    const payload = req.body?.payload
    if (!operation) {
      res.status(400).json({ error: 'operation required' })
      return
    }
    const isMut = FLEET_MUTATION_OPS.has(operation)
    const perms = req.user!.permissions
    if (isMut) {
      const ok =
        roleHasPermission(perms, 'amr.missions.manage') || roleHasPermission(perms, 'amr.tools.dev')
      if (!ok) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
    } else {
      const canQuery =
        roleHasPermission(perms, 'module.amr') ||
        roleHasPermission(perms, 'amr.settings') ||
        roleHasPermission(perms, 'amr.tools.dev')
      if (!canQuery) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
    }
    const cfg = await getAmrFleetConfig(db)
    const fr = await forwardAmrFleetRequest(cfg, operation, payload, {
      db,
      source: 'fleet-proxy',
      userId: req.user!.id,
    })
    res.status(fr.status).json(fr.json)
  })
)

router.get(
  '/dc/stands',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const rows = (await db.prepare('SELECT * FROM amr_stands ORDER BY zone, external_ref').all()) as Record<
      string,
      unknown
    >[]
    res.json({ stands: rows })
  })
)

router.post(
  '/dc/stands',
  authMiddleware,
  requirePermission('amr.stands.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const b = req.body as Record<string, unknown>
    const id = uuidv4()
    const zone = typeof b.zone === 'string' ? b.zone : ''
    const external_ref = typeof b.external_ref === 'string' ? b.external_ref.trim() : ''
    if (!external_ref) {
      res.status(400).json({ error: 'external_ref required' })
      return
    }
    let location_label = typeof b.location_label === 'string' ? b.location_label.trim() : ''
    if (!location_label) location_label = external_ref
    const dwg_ref = normalizeDwgRef(b.dwg_ref)
    const orientation = typeof b.orientation === 'string' ? b.orientation : '0'
    const x = typeof b.x === 'number' ? b.x : 0
    const y = typeof b.y === 'number' ? b.y : 0
    const enabled = b.enabled === false ? 0 : 1
    const ts = nowTs()

    if (await standIdWithExternalRef(external_ref)) {
      res.status(400).json({
        error: `Location (External Ref) "${external_ref}" is already used by another stand.`,
      })
      return
    }
    if (dwg_ref && (await standIdWithDwgRef(dwg_ref))) {
      res.status(400).json({
        error: `DWG ref "${dwg_ref}" is already used by another stand.`,
      })
      return
    }

    await db
      .prepare(
        `INSERT INTO amr_stands (id, zone, location_label, external_ref, dwg_ref, orientation, x, y, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, zone, location_label, external_ref, dwg_ref, orientation, x, y, enabled, ts, ts)
    const row = (await db.prepare('SELECT * FROM amr_stands WHERE id = ?').get(id)) as Record<
      string,
      unknown
    >
    res.status(201).json(row)
  })
)

router.patch(
  '/dc/stands/:id',
  authMiddleware,
  requirePermission('amr.stands.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const id = String(req.params.id ?? '')
    const existing = (await db.prepare('SELECT * FROM amr_stands WHERE id = ?').get(id)) as Record<
      string,
      unknown
    > | null
    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const b = req.body as Record<string, unknown>
    const zone = typeof b.zone === 'string' ? b.zone : existing.zone
    const external_ref =
      typeof b.external_ref === 'string' ? b.external_ref.trim() : String(existing.external_ref ?? '')
    let location_label =
      typeof b.location_label === 'string'
        ? b.location_label.trim()
        : String(existing.location_label ?? '')
    if (!location_label) location_label = external_ref
    const dwg_ref =
      typeof b.dwg_ref === 'string'
        ? normalizeDwgRef(b.dwg_ref)
        : b.dwg_ref === null
          ? null
          : normalizeDwgRef(existing.dwg_ref)
    const orientation = typeof b.orientation === 'string' ? b.orientation : existing.orientation
    const x = typeof b.x === 'number' ? b.x : Number(existing.x ?? 0)
    const y = typeof b.y === 'number' ? b.y : Number(existing.y ?? 0)
    const enabled = b.enabled === false ? 0 : b.enabled === true ? 1 : Number(existing.enabled ?? 1)

    const conflictLoc = await standIdWithExternalRef(external_ref, id)
    if (conflictLoc) {
      res.status(400).json({
        error: `Location (External Ref) "${external_ref}" is already used by another stand.`,
      })
      return
    }
    if (dwg_ref && (await standIdWithDwgRef(dwg_ref, id))) {
      res.status(400).json({
        error: `DWG ref "${dwg_ref}" is already used by another stand.`,
      })
      return
    }

    await db
      .prepare(
        `UPDATE amr_stands SET zone = ?, location_label = ?, external_ref = ?, dwg_ref = ?, orientation = ?, x = ?, y = ?, enabled = ?, updated_at = ? WHERE id = ?`
      )
      .run(zone, location_label, external_ref, dwg_ref, orientation, x, y, enabled, nowTs(), id)
    const row = (await db.prepare('SELECT * FROM amr_stands WHERE id = ?').get(id)) as Record<string, unknown>
    res.json(row)
  })
)

router.delete(
  '/dc/stands/:id',
  authMiddleware,
  requirePermission('amr.stands.manage'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '')
    const r = await db.prepare('DELETE FROM amr_stands WHERE id = ?').run(id)
    if (!r.changes) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.status(204).send()
  })
)

router.post(
  '/dc/stands/import',
  authMiddleware,
  requirePermission('amr.stands.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const raw =
      typeof req.body?.csv === 'string'
        ? req.body.csv
        : typeof req.body?.text === 'string'
          ? req.body.text
          : ''
    if (!raw.trim()) {
      res.status(400).json({ error: 'csv text required' })
      return
    }
    const parsed = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true })
    if (parsed.errors.length) {
      res.status(400).json({ error: parsed.errors[0]?.message ?? 'CSV parse error' })
      return
    }

    type ImportFailure = { line: number; external_ref: string | null; reason: string }
    const failures: ImportFailure[] = []

    /** First data row line (1-based, header = line 1) for each external_ref / dwg in file order. */
    const firstCsvLineForRef = new Map<string, number>()
    const firstCsvLineForDwg = new Map<string, number>()
    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i]
      const line = i + 2
      const external_ref = (row.external_ref ?? row.ExternalReference ?? row.location ?? '').trim()
      if (!external_ref) continue
      if (!firstCsvLineForRef.has(external_ref)) firstCsvLineForRef.set(external_ref, line)
      const dwgNorm = normalizeDwgRef(row.dwg_ref ?? row.DWG ?? '')
      if (dwgNorm && !firstCsvLineForDwg.has(dwgNorm)) firstCsvLineForDwg.set(dwgNorm, line)
    }

    let n = 0
    const ts = nowTs()
    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i]
      const line = i + 2
      const external_ref = (row.external_ref ?? row.ExternalReference ?? row.location ?? '').trim()
      if (!external_ref) {
        failures.push({
          line,
          external_ref: null,
          reason: 'Missing Location (External Ref).',
        })
        continue
      }

      const winnerRefLine = firstCsvLineForRef.get(external_ref)
      if (winnerRefLine !== line) {
        failures.push({
          line,
          external_ref,
          reason: `Duplicate Location (external_ref) in CSV (first row ${winnerRefLine ?? '?'}).`,
        })
        continue
      }

      const zone = row.zone ?? row.Zone ?? ''
      const location_label =
        String(row.location_label ?? row.Location ?? '').trim() || external_ref
      const dwgNorm = normalizeDwgRef(row.dwg_ref ?? row.DWG ?? '')
      const orientation = row.orientation ?? row.Orientation ?? '0'
      const x = parseFloat(row.x ?? '0') || 0
      const y = parseFloat(row.y ?? '0') || 0
      const enabled =
        String(row.enabled ?? row.Enabled ?? 'true').toLowerCase() === 'false' ? 0 : 1

      if (dwgNorm) {
        const winnerDwgLine = firstCsvLineForDwg.get(dwgNorm)
        if (winnerDwgLine !== line) {
          failures.push({
            line,
            external_ref,
            reason: `Duplicate DWG ref in CSV (first row ${winnerDwgLine ?? '?'}).`,
          })
          continue
        }
      }

      const existing = (await db.prepare('SELECT id FROM amr_stands WHERE external_ref = ?').get(external_ref)) as
        | { id: string }
        | undefined
      try {
        if (existing) {
          if (dwgNorm && (await standIdWithDwgRef(dwgNorm, existing.id))) {
            failures.push({
              line,
              external_ref,
              reason: `DWG ref "${dwgNorm}" is already used by another stand.`,
            })
            continue
          }
          await db
            .prepare(
              `UPDATE amr_stands SET zone = ?, location_label = ?, dwg_ref = ?, orientation = ?, x = ?, y = ?, enabled = ?, updated_at = ? WHERE id = ?`
            )
            .run(zone, location_label, dwgNorm, orientation, x, y, enabled, ts, existing.id)
        } else {
          if (dwgNorm && (await standIdWithDwgRef(dwgNorm))) {
            failures.push({
              line,
              external_ref,
              reason: `DWG ref "${dwgNorm}" is already used by another stand.`,
            })
            continue
          }
          const id = uuidv4()
          await db
            .prepare(
              `INSERT INTO amr_stands (id, zone, location_label, external_ref, dwg_ref, orientation, x, y, enabled, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(id, zone, location_label, external_ref, dwgNorm, orientation, x, y, enabled, ts, ts)
        }
        n += 1
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failures.push({
          line,
          external_ref,
          reason: msg.includes('SQLITE_CONSTRAINT') ? `Database constraint: ${msg}` : msg,
        })
      }
    }
    failures.sort((a, b) => a.line - b.line)
    res.json({ imported: n, failures })
  })
)

router.get(
  '/dc/mission-records',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT r.*, u.username AS created_by_username,
                ms.status AS multistop_session_status,
                ms.next_segment_index AS multistop_next_segment_index
         FROM amr_mission_records r
         LEFT JOIN users u ON u.id = r.created_by
         LEFT JOIN amr_multistop_sessions ms ON ms.id = r.multistop_session_id
         ORDER BY r.created_at DESC LIMIT 500`
      )
      .all()) as Record<string, unknown>[]
    const pendingFirst = (await db
      .prepare(
        `SELECT ms.* FROM amr_multistop_sessions ms
         WHERE ms.status = 'awaiting_continue' AND ms.next_segment_index = 0
         AND NOT EXISTS (SELECT 1 FROM amr_mission_records r WHERE r.multistop_session_id = ms.id)`
      )
      .all()) as Record<string, unknown>[]
    const synthetic: Record<string, unknown>[] = []
    for (const ms of pendingFirst) {
      const sid = String(ms.id ?? '').trim()
      if (!sid) continue
      const base =
        typeof ms.base_mission_code === 'string' && ms.base_mission_code.trim()
          ? String(ms.base_mission_code).trim()
          : genDCA('RM')
      const mc = multistopSegmentMissionCode(base, 0)
      const ts = String(ms.created_at ?? ms.updated_at ?? nowTs())
      synthetic.push({
        id: `__pending_first__${sid}`,
        job_code: mc,
        mission_code: mc,
        container_code: ms.container_code ?? null,
        created_by: ms.created_by ?? null,
        mission_type: 'RACK_MOVE',
        mission_payload_json: JSON.stringify({ deferredFirstSegment: true }),
        last_status: null,
        worker_closed: 0,
        finalized: 0,
        persistent_container: ms.persistent_container ?? 0,
        container_out_done: 0,
        final_position: ms.pickup_position != null ? String(ms.pickup_position) : '',
        multistop_session_id: sid,
        multistop_step_index: 0,
        created_at: ts,
        updated_at: ms.updated_at != null ? String(ms.updated_at) : ts,
        created_by_username: null,
        multistop_session_status: 'awaiting_continue',
        multistop_next_segment_index: 0,
      })
    }
    const merged = [...rows, ...synthetic].sort((a, b) =>
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
    )
    res.json({ records: merged.slice(0, 500) })
  })
)

router.get(
  '/dc/missions/attention',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT id, status, pickup_position, container_code, next_segment_index, total_segments, updated_at, continue_not_before
         FROM amr_multistop_sessions
         WHERE status IN ('awaiting_continue', 'failed')
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all()) as Record<string, unknown>[]
    res.json({
      count: rows.length,
      items: rows.map((r) => ({
        sessionId: String(r.id ?? ''),
        status: String(r.status ?? ''),
        pickupPosition: r.pickup_position != null ? String(r.pickup_position) : '',
        containerCode: r.container_code != null && String(r.container_code) !== '' ? String(r.container_code) : null,
        nextSegmentIndex: Number(r.next_segment_index),
        totalSegments: Number(r.total_segments),
        updatedAt: r.updated_at != null ? String(r.updated_at) : null,
        continueNotBefore:
          r.continue_not_before != null && String(r.continue_not_before).trim()
            ? String(r.continue_not_before)
            : null,
      })),
    })
  })
)

router.get(
  '/dc/mission-log',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT l.*, r.job_code FROM amr_mission_status_log l
         JOIN amr_mission_records r ON r.id = l.mission_record_id
         ORDER BY l.recorded_at DESC LIMIT 1000`
      )
      .all()) as Record<string, unknown>[]
    res.json({ entries: rows })
  })
)

router.get(
  '/dc/fleet-api-log',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT f.*, r.job_code, u.username AS user_username
         FROM amr_fleet_api_log f
         LEFT JOIN amr_mission_records r ON r.id = f.mission_record_id
         LEFT JOIN users u ON u.id = f.user_id
         ORDER BY f.recorded_at DESC
         LIMIT 1500`
      )
      .all()) as Record<string, unknown>[]
    res.json({ entries: rows })
  })
)

router.post(
  '/dc/missions/rack-move',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const cfg = await getAmrFleetConfig(db)
    const b = req.body as Record<string, unknown>
    const missionData = b.missionData
    if (!Array.isArray(missionData) || missionData.length === 0) {
      res.status(400).json({ error: 'missionData required' })
      return
    }
    if (missionData.length !== 2) {
      res.status(400).json({ error: 'missionData must contain exactly 2 steps (use Add Stop for more than one segment)' })
      return
    }
    const sorted = [...missionData].sort(
      (a: { sequence?: number }, b: { sequence?: number }) => (a.sequence ?? 0) - (b.sequence ?? 0)
    )
    /** Fleet submitMission: always AUTO / 0 wait (UI no longer exposes strategy). */
    const sortedForSubmit = sorted.map((step) => {
      const s = step as Record<string, unknown>
      return { ...s, passStrategy: 'AUTO', waitingMillis: 0 }
    })
    const first = sortedForSubmit[0] as { position?: string }
    if (!first?.position || typeof first.position !== 'string') {
      res.status(400).json({ error: 'missionData[0].position required' })
      return
    }

    let missionCode =
      typeof b.missionCode === 'string' && b.missionCode.trim() ? b.missionCode.trim() : genDCA('RM')
    let containerCode =
      typeof b.containerCode === 'string' && b.containerCode.trim()
        ? b.containerCode.trim()
        : uuidv4().replace(/-/g, '').slice(0, 16)

    const persistentContainer = Boolean(b.persistentContainer)
    const enterOrientation =
      typeof b.enterOrientation === 'string' && b.enterOrientation.trim()
        ? b.enterOrientation.trim()
        : '0'

    const missionRecordId = uuidv4()

    const ciPayload = {
      orgId: cfg.orgId,
      requestId: genDCA('CI'),
      containerType: cfg.containerType,
      containerModelCode: cfg.containerModelCode,
      position: first.position,
      containerCode,
      enterOrientation,
      isNew: true,
    }

    const ci = await forwardAmrFleetRequest(cfg, 'containerIn', ciPayload, {
      db,
      source: 'rack-move',
      missionRecordId,
      userId: req.user!.id,
    })
    if (!ci.ok) {
      res.status(ci.status).json(ci.json)
      return
    }
    if (!fleetJsonIndicatesSuccess(ci.json)) {
      res.status(400).json({
        error: 'containerIn was rejected by the fleet; submitMission was not called.',
        fleet: ci.json,
      })
      return
    }

    /** containerIn runs first; submitMission is the next fleet call (sequential, not parallel). */
    const submitPayload = {
      orgId: cfg.orgId,
      requestId: missionCode,
      missionCode,
      missionType: typeof b.missionType === 'string' ? b.missionType : 'RACK_MOVE',
      robotType: cfg.robotType,
      lockRobotAfterFinish: typeof b.lockRobotAfterFinish === 'string' ? b.lockRobotAfterFinish : 'false',
      unlockRobotId: typeof b.unlockRobotId === 'string' ? b.unlockRobotId : '',
      robotModels: cfg.robotModels,
      robotIds: Array.isArray(b.robotIds) ? b.robotIds : cfg.robotIdsDefault,
      missionData: sortedForSubmit,
      /** Same physical container as containerIn — fleet must not treat each submitMission as a new load. */
      containerCode,
    }

    const sm = await forwardAmrFleetRequest(cfg, 'submitMission', submitPayload, {
      db,
      source: 'rack-move',
      missionRecordId,
      userId: req.user!.id,
    })
    if (!sm.ok) {
      res.status(sm.status).json(sm.json)
      return
    }
    if (!fleetJsonIndicatesSuccess(sm.json)) {
      res.status(400).json({
        error: 'submitMission was rejected by the fleet; mission record was not created.',
        fleetContainerIn: ci.json,
        fleetSubmitMission: sm.json,
      })
      return
    }

    const id = missionRecordId
    const finalPos =
      (sortedForSubmit[sortedForSubmit.length - 1] as { position?: string })?.position ?? first.position
    const ts = nowTs()
    await db
      .prepare(
        `INSERT INTO amr_mission_records (id, job_code, mission_code, container_code, created_by, mission_type, mission_payload_json, last_status, persistent_container, worker_closed, finalized, container_out_done, final_position, multistop_session_id, multistop_step_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, NULL, NULL, ?, ?)`
      )
      .run(
        id,
        missionCode,
        missionCode,
        containerCode,
        req.user!.id,
        String(submitPayload.missionType),
        JSON.stringify({ submit: submitPayload, containerIn: ciPayload }),
        null,
        persistentContainer ? 1 : 0,
        finalPos,
        ts,
        ts
      )

    res.status(201).json({
      missionRecordId: id,
      missionCode,
      containerCode,
      fleetSubmit: sm.json,
      fleetContainerIn: ci.json,
    })
  })
)

router.get(
  '/dc/missions/multistop/:sessionId',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (req, res) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId.trim() : ''
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' })
      return
    }
    const session = (await db
      .prepare('SELECT * FROM amr_multistop_sessions WHERE id = ?')
      .get(sessionId)) as Record<string, unknown> | undefined
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    const records = (await db
      .prepare(
        `SELECT r.*, u.username AS created_by_username FROM amr_mission_records r
         LEFT JOIN users u ON u.id = r.created_by
         WHERE r.multistop_session_id = ? ORDER BY r.multistop_step_index ASC, r.created_at ASC`
      )
      .all(sessionId)) as Record<string, unknown>[]
    res.json({ session, records })
  })
)

router.patch(
  '/dc/missions/multistop/:sessionId',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId.trim() : ''
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' })
      return
    }
    const row = (await db.prepare('SELECT * FROM amr_multistop_sessions WHERE id = ?').get(sessionId)) as
      | {
          id: string
          status: string
          plan_json: string
          total_segments: number
          next_segment_index: number
        }
      | undefined
    if (!row) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (row.status !== 'awaiting_continue') {
      res.status(409).json({ error: 'Plan can only be edited while waiting to continue' })
      return
    }
    const body = req.body as Record<string, unknown>
    const destIn = body.destinations
    if (!Array.isArray(destIn)) {
      res.status(400).json({ error: 'destinations array required' })
      return
    }
    const newPlan: MultistopPlan = { destinations: [] }
    for (const x of destIn) {
      if (!x || typeof x !== 'object') {
        res.status(400).json({ error: 'invalid destinations entry' })
        return
      }
      const norm = normalizeDestinationInput(x as Record<string, unknown>)
      if (!norm.ok) {
        res.status(400).json({ error: norm.error })
        return
      }
      newPlan.destinations.push(norm.dest)
    }
    const nextIdx = Number(row.next_segment_index)
    if (!Number.isFinite(nextIdx) || newPlan.destinations.length < nextIdx + 1) {
      res.status(400).json({ error: 'destinations must include at least one stop after the current segment' })
      return
    }
    const oldPlan = parseMultistopPlan(JSON.parse(row.plan_json || '{}'))
    if (oldPlan) {
      for (let i = 0; i < nextIdx; i++) {
        const a = oldPlan.destinations[i]?.position.trim()
        const b = newPlan.destinations[i]?.position.trim()
        if (a !== b) {
          res.status(400).json({ error: `Cannot change completed segment destination at index ${i}` })
          return
        }
      }
    }
    const pcPatch = body.pickupContinue
    if (pcPatch != null && typeof pcPatch === 'object') {
      const pc = normalizePickupContinueInput(pcPatch as Record<string, unknown>)
      if (!pc.ok) {
        res.status(400).json({ error: pc.error })
        return
      }
      newPlan.pickupContinue = pc.value
    } else if (oldPlan?.pickupContinue) {
      newPlan.pickupContinue = oldPlan.pickupContinue
    }
    const total_segments = newPlan.destinations.length
    const ts = nowTs()
    const continueDeadline = continueNotBeforeForAwaitingSession(newPlan, nextIdx, Date.now())
    await db
      .prepare(
        `UPDATE amr_multistop_sessions SET plan_json = ?, total_segments = ?, continue_not_before = ?, updated_at = ? WHERE id = ?`
      )
      .run(JSON.stringify(newPlan), total_segments, continueDeadline, ts, sessionId)
    res.json({ ok: true, sessionId, total_segments, next_segment_index: nextIdx })
  })
)

router.post(
  '/dc/missions/multistop/:sessionId/continue',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId.trim() : ''
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' })
      return
    }
    const cfg = await getAmrFleetConfig(db)
    const result = await executeMultistopContinue({
      db,
      cfg,
      sessionId,
      userId: req.user!.id,
      source: 'multistop-continue',
    })
    if (!result.ok) {
      if (result.status === 404) res.status(404).json({ error: result.error })
      else if (result.status === 409) res.status(409).json({ error: result.error })
      else if (result.status === 400)
        res.status(400).json({ error: result.error, fleetSubmitMission: result.json })
      else res.status(result.status).json(result.json ?? { error: result.error })
      return
    }
    res.status(201).json({
      missionRecordId: result.missionRecordId,
      missionCode: result.missionCode,
      multistopSessionId: result.multistopSessionId,
      next_segment_index: result.next_segment_index,
      fleetSubmit: result.fleetSubmit,
    })
  })
)

router.post(
  '/dc/missions/multistop',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const cfg = await getAmrFleetConfig(db)
    const b = req.body as Record<string, unknown>
    const pickupRaw = typeof b.pickupPosition === 'string' ? b.pickupPosition.trim() : ''
    if (!pickupRaw) {
      res.status(400).json({ error: 'pickupPosition required' })
      return
    }
    const destIn = b.destinations
    if (!Array.isArray(destIn) || destIn.length === 0) {
      res.status(400).json({ error: 'destinations required (non-empty array)' })
      return
    }
    const plan: MultistopPlan = { destinations: [] }
    for (const x of destIn) {
      if (!x || typeof x !== 'object') {
        res.status(400).json({ error: 'invalid destinations entry' })
        return
      }
      const norm = normalizeDestinationInput(x as Record<string, unknown>)
      if (!norm.ok) {
        res.status(400).json({ error: norm.error })
        return
      }
      plan.destinations.push(norm.dest)
    }
    const pcIn = b.pickupContinue
    if (pcIn != null && typeof pcIn === 'object') {
      const pc = normalizePickupContinueInput(pcIn as Record<string, unknown>)
      if (!pc.ok) {
        res.status(400).json({ error: pc.error })
        return
      }
      plan.pickupContinue = pc.value
    }
    const baseMissionCode =
      typeof b.missionCode === 'string' && b.missionCode.trim() ? b.missionCode.trim() : genDCA('RM')
    const missionCode = multistopSegmentMissionCode(baseMissionCode, 0)
    let containerCode =
      typeof b.containerCode === 'string' && b.containerCode.trim()
        ? b.containerCode.trim()
        : uuidv4().replace(/-/g, '').slice(0, 16)
    const persistentContainer = Boolean(b.persistentContainer)
    const enterOrientation =
      typeof b.enterOrientation === 'string' && b.enterOrientation.trim() ? b.enterOrientation.trim() : '0'
    const robotIds = Array.isArray(b.robotIds) ? b.robotIds.filter((x): x is string => typeof x === 'string') : cfg.robotIdsDefault

    const sessionId = uuidv4()
    const total_segments = plan.destinations.length
    const missionRecordId = uuidv4()

    const ciPayload = {
      orgId: cfg.orgId,
      requestId: genDCA('CI'),
      containerType: cfg.containerType,
      containerModelCode: cfg.containerModelCode,
      position: pickupRaw,
      containerCode,
      enterOrientation,
      isNew: true,
    }
    const ci = await forwardAmrFleetRequest(cfg, 'containerIn', ciPayload, {
      db,
      source: 'multistop-start',
      missionRecordId,
      userId: req.user!.id,
    })
    if (!ci.ok) {
      res.status(ci.status).json(ci.json)
      return
    }
    if (!fleetJsonIndicatesSuccess(ci.json)) {
      res.status(400).json({
        error: 'containerIn was rejected by the fleet; submitMission was not called.',
        fleet: ci.json,
      })
      return
    }

    const planJson = JSON.stringify(plan)
    const robotIdsJson = JSON.stringify(robotIds)
    const ts = nowTs()
    const deferFirst = shouldDeferFirstSegmentSubmit(plan)

    if (deferFirst) {
      const continueNotBefore = continueNotBeforeDeferredFirstSegment(plan, Date.now())
      await db
        .prepare(
          `INSERT INTO amr_multistop_sessions (id, status, pickup_position, plan_json, total_segments, next_segment_index, locked_robot_id, container_code, persistent_container, enter_orientation, robot_ids_json, base_mission_code, continue_not_before, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId,
          'awaiting_continue',
          pickupRaw,
          planJson,
          total_segments,
          0,
          containerCode,
          persistentContainer ? 1 : 0,
          enterOrientation,
          robotIdsJson,
          baseMissionCode,
          continueNotBefore,
          req.user!.id,
          ts,
          ts
        )
      res.status(201).json({
        multistopSessionId: sessionId,
        missionRecordId: null,
        missionCode: null,
        baseMissionCode,
        containerCode,
        total_segments,
        next_segment_index: 0,
        firstSegmentDeferred: true,
        fleetSubmit: null,
        fleetContainerIn: ci.json,
      })
      return
    }

    /** containerIn runs first; submitMission is the next fleet call (sequential, not parallel). */
    const missionData = buildSegmentMissionData(pickupRaw, plan, 0)
    const lockRobotAfterFinish = total_segments > 1 ? 'true' : 'false'
    const submitPayload = {
      orgId: cfg.orgId,
      requestId: missionCode,
      missionCode,
      missionType: 'RACK_MOVE',
      robotType: cfg.robotType,
      lockRobotAfterFinish,
      unlockRobotId: '',
      robotModels: cfg.robotModels,
      robotIds,
      missionData,
      /** Same container as containerIn — only one container registration for the whole multistop session. */
      containerCode,
    }
    const sm = await forwardAmrFleetRequest(cfg, 'submitMission', submitPayload, {
      db,
      source: 'multistop-start',
      missionRecordId,
      userId: req.user!.id,
    })
    if (!sm.ok) {
      res.status(sm.status).json(sm.json)
      return
    }
    if (!fleetJsonIndicatesSuccess(sm.json)) {
      res.status(400).json({
        error: 'submitMission was rejected by the fleet; session was not created.',
        fleetContainerIn: ci.json,
        fleetSubmitMission: sm.json,
      })
      return
    }

    const finalPos = plan.destinations[plan.destinations.length - 1]?.position ?? pickupRaw
    await db
      .prepare(
        `INSERT INTO amr_multistop_sessions (id, status, pickup_position, plan_json, total_segments, next_segment_index, locked_robot_id, container_code, persistent_container, enter_orientation, robot_ids_json, base_mission_code, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        'active',
        pickupRaw,
        planJson,
        total_segments,
        1,
        containerCode,
        persistentContainer ? 1 : 0,
        enterOrientation,
        robotIdsJson,
        baseMissionCode,
        req.user!.id,
        ts,
        ts
      )
    await db
      .prepare(
        `INSERT INTO amr_mission_records (id, job_code, mission_code, container_code, created_by, mission_type, mission_payload_json, last_status, persistent_container, worker_closed, finalized, container_out_done, final_position, multistop_session_id, multistop_step_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`
      )
      .run(
        missionRecordId,
        missionCode,
        missionCode,
        containerCode,
        req.user!.id,
        'RACK_MOVE',
        JSON.stringify({ submit: submitPayload, containerIn: ciPayload }),
        null,
        persistentContainer ? 1 : 0,
        finalPos,
        sessionId,
        0,
        ts,
        ts
      )

    res.status(201).json({
      multistopSessionId: sessionId,
      missionRecordId,
      missionCode,
      baseMissionCode,
      containerCode,
      total_segments,
      fleetSubmit: sm.json,
      fleetContainerIn: ci.json,
    })
  })
)

export { router as amrRouter }
