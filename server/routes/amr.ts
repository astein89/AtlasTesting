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
  normalizeZoneCategories,
  type AmrFleetConfig,
} from '../lib/amrConfig.js'
import {
  getAmrHyperionConfig,
  saveAmrHyperionConfig,
  publicAmrHyperionConfig,
  hyperionConfigured,
  type AmrHyperionConfig,
} from '../lib/hyperionConfig.js'
import { fetchStandPresenceFromHyperion } from '../lib/amrStandPresence.js'
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
import {
  executeMultistopContinue,
  multistopSegmentMissionCode,
  resolveMultistopBaseMissionCode,
} from '../lib/amrMultistopContinue.js'
import { rescheduleAmrMissionWorker } from '../lib/amrMissionWorker.js'
import {
  validateMissionTemplatePayload,
  templateListCardFieldsFromPayloadJson,
  type AmrMissionTemplatePayloadV1,
} from '../lib/amrMissionTemplate.js'

function jsonMissionTemplatePayload(p: AmrMissionTemplatePayloadV1): string {
  return JSON.stringify(p)
}

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

/** Loose boolean coercion: accepts boolean, 0/1 number, or `'true' | 'false' | '1' | '0' | 'yes' | 'no'` strings. */
function coerceBoolFlag(v: unknown, fallback: 0 | 1): 0 | 1 {
  if (v === undefined) return fallback
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v ? 1 : 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return 1
    if (s === 'false' || s === '0' || s === 'no' || s === '') return 0
  }
  return fallback
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

type StandLegToValidate = { position: string; putDown: boolean }

/**
 * Validate that no leg targets a stand whose `block_pickup` (no lift) / `block_dropoff` (no lower) flag forbids the
 * step's lift/drop direction. When `override` is true and the caller has `amr.stands.override-special`, violations are
 * allowed through.
 */
async function validateStandBlocksForLegs(
  legs: StandLegToValidate[],
  override: boolean,
  hasOverridePerm: boolean
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const refs: string[] = []
  const seen = new Set<string>()
  for (const leg of legs) {
    const p = leg.position.trim()
    if (!p || seen.has(p)) continue
    seen.add(p)
    refs.push(p)
  }
  if (refs.length === 0) return { ok: true }
  const placeholders = refs.map(() => '?').join(', ')
  const rows = (await db
    .prepare(
      `SELECT external_ref, block_pickup, block_dropoff FROM amr_stands WHERE external_ref IN (${placeholders})`
    )
    .all(...refs)) as Array<{ external_ref: string; block_pickup: number; block_dropoff: number }>
  const byRef = new Map(rows.map((r) => [r.external_ref, r]))
  const violations: string[] = []
  for (const leg of legs) {
    const p = leg.position.trim()
    if (!p) continue
    const stand = byRef.get(p)
    if (!stand) continue
    if (!leg.putDown && Number(stand.block_pickup) === 1) {
      violations.push(`Location "${p}" does not allow pallet pickup (no lift).`)
    }
    if (leg.putDown && Number(stand.block_dropoff) === 1) {
      violations.push(`Location "${p}" does not allow pallet dropoff (no lower).`)
    }
  }
  if (violations.length === 0) return { ok: true }
  if (override) {
    if (hasOverridePerm) return { ok: true }
    return {
      ok: false,
      status: 403,
      error: `Special-location override permission required: ${violations.join(' ')}`,
    }
  }
  return { ok: false, status: 400, error: violations.join(' ') }
}

router.get(
  '/dc/settings',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const fleet = publicAmrFleetConfig(await getAmrFleetConfig(db))
    const hyperion = publicAmrHyperionConfig(await getAmrHyperionConfig(db))
    res.json({ ...fleet, ...hyperion })
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
    if (typeof body.missionCreateStandPresenceSanityCheck === 'boolean')
      patch.missionCreateStandPresenceSanityCheck = body.missionCreateStandPresenceSanityCheck
    if ('zoneCategories' in body) {
      patch.zoneCategories = normalizeZoneCategories(body.zoneCategories)
    }
    if (typeof body.authKey === 'string') patch.authKey = body.authKey

    const next = await saveAmrFleetConfig(db, patch)
    rescheduleAmrMissionWorker()

    const hPatch: Partial<AmrHyperionConfig> & { password?: string } = {}
    if (typeof body.hyperionBaseUrl === 'string') hPatch.baseUrl = body.hyperionBaseUrl
    if (typeof body.hyperionUsername === 'string') hPatch.username = body.hyperionUsername
    if (typeof body.hyperionPassword === 'string' && body.hyperionPassword.length > 0) {
      hPatch.password = body.hyperionPassword
    }
    if (Object.keys(hPatch).length > 0) {
      await saveAmrHyperionConfig(db, hPatch)
    }

    const fleetOut = publicAmrFleetConfig(next)
    const hyperionOut = publicAmrHyperionConfig(await getAmrHyperionConfig(db))
    res.json({ ...fleetOut, ...hyperionOut })
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

router.post(
  '/dc/stands/presence',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (req: AuthRequest, res) => {
    const body = req.body as { standIds?: unknown }
    const raw = body?.standIds
    let standIds: string[] | undefined
    if (Array.isArray(raw)) {
      standIds = raw.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
      if (standIds.length === 0) {
        res.json({ presence: {} as Record<string, boolean> })
        return
      }
    }
    const hcfg = await getAmrHyperionConfig(db)
    if (!hyperionConfigured(hcfg)) {
      res.status(503).json({
        error: 'Hyperion API is not configured. Set base URL, username, and password under AMR settings.',
      })
      return
    }
    const result = await fetchStandPresenceFromHyperion(hcfg, standIds, {
      db,
      source: 'hyperion-stand-presence',
      userId: req.user!.id,
    })
    if (!result.ok) {
      const code = result.status && result.status >= 400 && result.status < 600 ? result.status : 502
      res.status(code).json({ error: result.message })
      return
    }
    res.json({ presence: result.presence })
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
    const block_pickup = coerceBoolFlag(b.block_pickup, 0)
    const block_dropoff = coerceBoolFlag(b.block_dropoff, 0)
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
        `INSERT INTO amr_stands (id, zone, location_label, external_ref, dwg_ref, orientation, x, y, enabled, block_pickup, block_dropoff, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        zone,
        location_label,
        external_ref,
        dwg_ref,
        orientation,
        x,
        y,
        enabled,
        block_pickup,
        block_dropoff,
        ts,
        ts
      )
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
    const block_pickup =
      'block_pickup' in b
        ? coerceBoolFlag(b.block_pickup, 0)
        : (Number(existing.block_pickup ?? 0) ? 1 : 0)
    const block_dropoff =
      'block_dropoff' in b
        ? coerceBoolFlag(b.block_dropoff, 0)
        : (Number(existing.block_dropoff ?? 0) ? 1 : 0)

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
        `UPDATE amr_stands SET zone = ?, location_label = ?, external_ref = ?, dwg_ref = ?, orientation = ?, x = ?, y = ?, enabled = ?, block_pickup = ?, block_dropoff = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        zone,
        location_label,
        external_ref,
        dwg_ref,
        orientation,
        x,
        y,
        enabled,
        block_pickup,
        block_dropoff,
        nowTs(),
        id
      )
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
      const blockPickupRaw =
        row.block_pickup ??
        row['Block Pickup'] ??
        row.no_pickup ??
        row['No Pickup'] ??
        row.no_lift ??
        row.NoLift ??
        row['No Lift']
      const blockDropoffRaw =
        row.block_dropoff ??
        row['Block Dropoff'] ??
        row.no_dropoff ??
        row['No Dropoff'] ??
        row.no_lower ??
        row.NoLower ??
        row['No Lower']
      const block_pickup = coerceBoolFlag(blockPickupRaw, 0)
      const block_dropoff = coerceBoolFlag(blockDropoffRaw, 0)

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
              `UPDATE amr_stands SET zone = ?, location_label = ?, dwg_ref = ?, orientation = ?, x = ?, y = ?, enabled = ?, block_pickup = ?, block_dropoff = ?, updated_at = ? WHERE id = ?`
            )
            .run(
              zone,
              location_label,
              dwgNorm,
              orientation,
              x,
              y,
              enabled,
              block_pickup,
              block_dropoff,
              ts,
              existing.id
            )
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
              `INSERT INTO amr_stands (id, zone, location_label, external_ref, dwg_ref, orientation, x, y, enabled, block_pickup, block_dropoff, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              zone,
              location_label,
              external_ref,
              dwgNorm,
              orientation,
              x,
              y,
              enabled,
              block_pickup,
              block_dropoff,
              ts,
              ts
            )
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
                ms.next_segment_index AS multistop_next_segment_index,
                ms.locked_robot_id AS session_locked_robot_id
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
        session_locked_robot_id:
          typeof ms.locked_robot_id === 'string' && ms.locked_robot_id.trim()
            ? String(ms.locked_robot_id).trim()
            : null,
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
        `SELECT id, status, pickup_position, container_code, next_segment_index, total_segments, updated_at, continue_not_before, base_mission_code
         FROM amr_multistop_sessions
         WHERE status IN ('awaiting_continue', 'failed')
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all()) as Record<string, unknown>[]
    const items = await Promise.all(
      rows.map(async (r) => {
        const sessionId = String(r.id ?? '')
        const base = await resolveMultistopBaseMissionCode(db, r, sessionId)
        const nextSeg = Number(r.next_segment_index)
        const si = Number.isFinite(nextSeg) ? nextSeg : 0
        const missionCode = multistopSegmentMissionCode(base, si)
        return {
          sessionId,
          missionCode,
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
        }
      })
    )
    res.json({
      count: items.length,
      items,
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

    const legsToValidate: StandLegToValidate[] = sortedForSubmit.map((step) => {
      const s = step as Record<string, unknown>
      const pos = s.position
      return {
        position: typeof pos === 'string' ? pos : '',
        putDown: Boolean(s.putDown),
      }
    })
    const overrideRequested = b.override === true || b.override === 'true'
    const hasOverridePerm = roleHasPermission(req.user?.permissions ?? [], 'amr.stands.override-special')
    const blockCheck = await validateStandBlocksForLegs(legsToValidate, overrideRequested, hasOverridePerm)
    if (!blockCheck.ok) {
      res.status(blockCheck.status).json({ error: blockCheck.error })
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

router.delete(
  '/dc/missions/multistop/:sessionId',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId.trim() : ''
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' })
      return
    }
    const session = (await db.prepare('SELECT * FROM amr_multistop_sessions WHERE id = ?').get(sessionId)) as
      | Record<string, unknown>
      | undefined
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (String(session.status ?? '') !== 'awaiting_continue') {
      res.status(409).json({
        error: 'Only a session waiting to continue can be cancelled before the first submitMission',
      })
      return
    }
    const nextIdx = Number(session.next_segment_index)
    if (!Number.isFinite(nextIdx) || nextIdx !== 0) {
      res.status(409).json({ error: 'Cancel is only allowed before the first fleet segment has started' })
      return
    }
    const cntRow = (await db
      .prepare('SELECT COUNT(*) AS c FROM amr_mission_records WHERE multistop_session_id = ?')
      .get(sessionId)) as { c?: number | string } | undefined
    const recCount = Number(cntRow?.c ?? 0)
    if (!Number.isFinite(recCount) || recCount > 0) {
      res.status(409).json({ error: 'Cannot cancel: mission records already exist for this session' })
      return
    }

    const cfg = await getAmrFleetConfig(db)
    const containerCode = typeof session.container_code === 'string' ? session.container_code.trim() : ''
    const position = typeof session.pickup_position === 'string' ? session.pickup_position.trim() : ''
    if (!containerCode || !position) {
      res.status(500).json({ error: 'Session is missing container or pickup position' })
      return
    }
    const enterOrientationRaw = session.enter_orientation
    const enterOrientation =
      enterOrientationRaw != null && String(enterOrientationRaw).trim()
        ? String(enterOrientationRaw).trim()
        : '0'

    const outReq = {
      orgId: cfg.orgId,
      requestId: genDCA('CO'),
      containerType: cfg.containerType,
      containerModelCode: cfg.containerModelCode,
      containerCode,
      position,
      enterOrientation,
      isDelete: true,
    }
    const out = await forwardAmrFleetRequest(cfg, 'containerOut', outReq, {
      db,
      source: 'multistop-cancel',
      missionRecordId: null,
      userId: req.user!.id,
    })
    if (!out.ok || !fleetJsonIndicatesSuccess(out.json)) {
      res.status(502).json({
        error: 'Fleet containerOut failed; session was not cancelled.',
        fleetStatus: out.status,
        fleet: out.json,
      })
      return
    }

    const ts = nowTs()
    await db
      .prepare(`UPDATE amr_multistop_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?`)
      .run(ts, sessionId)
    rescheduleAmrMissionWorker()
    res.json({ ok: true, sessionId, status: 'cancelled' })
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

    const editLegsToValidate: StandLegToValidate[] = newPlan.destinations.map((d, i) => ({
      position: d.position,
      putDown: i === newPlan.destinations.length - 1 ? true : Boolean(d.putDown),
    }))
    const editOverrideRequested = body.override === true || body.override === 'true'
    const editHasOverridePerm = roleHasPermission(
      req.user?.permissions ?? [],
      'amr.stands.override-special'
    )
    const editBlockCheck = await validateStandBlocksForLegs(
      editLegsToValidate,
      editOverrideRequested,
      editHasOverridePerm
    )
    if (!editBlockCheck.ok) {
      res.status(editBlockCheck.status).json({ error: editBlockCheck.error })
      return
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
    const body = (req.body ?? {}) as Record<string, unknown>
    const forceRelease = body.forceRelease === true || body.forceRelease === 'true'
    if (
      forceRelease &&
      !roleHasPermission(req.user?.permissions ?? [], 'amr.missions.force_release')
    ) {
      res.status(403).json({ error: 'Force release permission required.' })
      return
    }
    const result = await executeMultistopContinue({
      db,
      cfg,
      sessionId,
      userId: req.user!.id,
      source: 'multistop-continue',
      skipStandPresenceCheck: forceRelease,
    })
    if (!result.ok) {
      if (result.status === 404) res.status(404).json({ error: result.error })
      else if (result.status === 409) {
        const ref = typeof result.standOccupiedRef === 'string' ? result.standOccupiedRef.trim() : ''
        res.status(409).json({
          error: result.error,
          ...(ref ? { code: 'STAND_OCCUPIED' as const, standOccupiedRef: ref } : {}),
        })
      }
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

/**
 * Failed multistop sessions cannot Continue. Best-effort fleet `missionCancel` on each segment mission code (newest
 * leg first), then mark all session mission rows closed and session `cancelled` so the worker and UI stop tracking them.
 */
router.post(
  '/dc/missions/multistop/:sessionId/terminate-stuck',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId.trim() : ''
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' })
      return
    }
    const session = (await db.prepare('SELECT id, status FROM amr_multistop_sessions WHERE id = ?').get(sessionId)) as
      | { id: string; status: string }
      | undefined
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (String(session.status) !== 'failed') {
      res.status(409).json({
        error: 'Only sessions in failed state can be terminated this way. Active or waiting sessions use Cancel or Continue.',
      })
      return
    }
    const cfg = await getAmrFleetConfig(db)
    const recRows = (await db
      .prepare(
        `SELECT mission_code, job_code, multistop_step_index FROM amr_mission_records
         WHERE multistop_session_id = ? ORDER BY COALESCE(multistop_step_index, 0) DESC, created_at DESC`
      )
      .all(sessionId)) as Array<{
      mission_code?: string | null
      job_code?: string | null
      multistop_step_index?: number | null
    }>
    const seen = new Set<string>()
    const orderedCodes: string[] = []
    for (const r of recRows) {
      const mc = typeof r.mission_code === 'string' ? r.mission_code.trim() : ''
      const jc = typeof r.job_code === 'string' ? r.job_code.trim() : ''
      const code = mc || jc
      if (!code || seen.has(code)) continue
      seen.add(code)
      orderedCodes.push(code)
    }

    const fleetCancels: Array<{ missionCode: string; ok: boolean; httpStatus: number; fleetSuccess?: boolean }> = []
    for (const missionCode of orderedCodes) {
      const cancelReq = {
        orgId: cfg.orgId,
        requestId: genDCA('MC'),
        missionCode,
        cancelMode: 'NORMAL',
      }
      const cr = await forwardAmrFleetRequest(cfg, 'missionCancel', cancelReq, {
        db,
        source: 'multistop-terminate-stuck',
        missionRecordId: null,
        userId: req.user!.id,
      })
      fleetCancels.push({
        missionCode,
        ok: cr.ok,
        httpStatus: cr.status,
        fleetSuccess: cr.ok ? fleetJsonIndicatesSuccess(cr.json) : undefined,
      })
    }

    const ts = nowTs()
    await db
      .prepare(`UPDATE amr_mission_records SET worker_closed = 1, updated_at = ? WHERE multistop_session_id = ?`)
      .run(ts, sessionId)
    await db
      .prepare(
        `UPDATE amr_multistop_sessions SET status = 'cancelled', continue_not_before = NULL, updated_at = ? WHERE id = ?`
      )
      .run(ts, sessionId)
    rescheduleAmrMissionWorker()
    res.json({
      ok: true,
      sessionId,
      status: 'cancelled',
      fleetCancels,
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

    const multistopLegsToValidate: StandLegToValidate[] = [
      { position: pickupRaw, putDown: false },
      ...plan.destinations.map((d, i) => ({
        position: d.position,
        putDown: i === plan.destinations.length - 1 ? true : Boolean(d.putDown),
      })),
    ]
    const overrideRequested = b.override === true || b.override === 'true'
    const hasOverridePerm = roleHasPermission(req.user?.permissions ?? [], 'amr.stands.override-special')
    const blockCheck = await validateStandBlocksForLegs(
      multistopLegsToValidate,
      overrideRequested,
      hasOverridePerm
    )
    if (!blockCheck.ok) {
      res.status(blockCheck.status).json({ error: blockCheck.error })
      return
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

router.get(
  '/dc/mission-templates',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT t.id, t.name, t.payload_json, t.created_at, t.updated_at, u.username AS created_by_username
         FROM amr_mission_templates t
         LEFT JOIN users u ON u.id = t.created_by
         ORDER BY LOWER(t.name)`
      )
      .all()) as Record<string, unknown>[]
    const templates = rows.map((r) => {
      const payloadJson = String(r.payload_json ?? '')
      const card = templateListCardFieldsFromPayloadJson(payloadJson)
      return {
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        stopCount: card.stopCount,
        stopLines: card.stopLines,
        robotIds: card.robotIds,
        createdAt: r.created_at != null ? String(r.created_at) : null,
        updatedAt: r.updated_at != null ? String(r.updated_at) : null,
        createdByUsername: r.created_by_username != null ? String(r.created_by_username) : null,
      }
    })
    res.json({ templates })
  })
)

router.get(
  '/dc/mission-templates/:id',
  authMiddleware,
  requirePermission('module.amr'),
  asyncRoute(async (req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : ''
    if (!id) {
      res.status(400).json({ error: 'template id required' })
      return
    }
    const row = (await db
      .prepare(
        `SELECT t.id, t.name, t.payload_json, t.created_at, t.updated_at, t.created_by, u.username AS created_by_username
         FROM amr_mission_templates t
         LEFT JOIN users u ON u.id = t.created_by
         WHERE t.id = ?`
      )
      .get(id)) as Record<string, unknown> | undefined
    if (!row) {
      res.status(404).json({ error: 'Template not found' })
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(String(row.payload_json ?? '{}'))
    } catch {
      res.status(500).json({ error: 'Stored template payload is invalid JSON' })
      return
    }
    const v = validateMissionTemplatePayload(payload)
    if (!v.ok) {
      res.status(500).json({ error: `Stored template invalid: ${v.error}` })
      return
    }
    res.json({
      template: {
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        payload: v.payload,
        createdAt: row.created_at != null ? String(row.created_at) : null,
        updatedAt: row.updated_at != null ? String(row.updated_at) : null,
        createdBy: row.created_by != null ? String(row.created_by) : null,
        createdByUsername: row.created_by_username != null ? String(row.created_by_username) : null,
      },
    })
  })
)

router.post(
  '/dc/mission-templates',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const b = req.body as Record<string, unknown>
    const nameRaw = typeof b.name === 'string' ? b.name.trim() : ''
    if (!nameRaw) {
      res.status(400).json({ error: 'name required' })
      return
    }
    const v = validateMissionTemplatePayload(b.payload)
    if (!v.ok) {
      res.status(400).json({ error: v.error })
      return
    }
    {
      const tmplLegs: StandLegToValidate[] = v.payload.legs.map((leg, i) => ({
        position: leg.position,
        putDown: i === 0 ? false : i === v.payload.legs.length - 1 ? true : Boolean(leg.putDown),
      }))
      const overrideRequested = b.override === true || b.override === 'true'
      const hasOverridePerm = roleHasPermission(
        req.user?.permissions ?? [],
        'amr.stands.override-special'
      )
      const blockCheck = await validateStandBlocksForLegs(tmplLegs, overrideRequested, hasOverridePerm)
      if (!blockCheck.ok) {
        res.status(blockCheck.status).json({ error: blockCheck.error })
        return
      }
    }
    const dupe = (await db.prepare('SELECT id FROM amr_mission_templates WHERE LOWER(name) = LOWER(?)').get(nameRaw)) as
      | { id: string }
      | undefined
    if (dupe) {
      res.status(409).json({ error: 'A template with this name already exists' })
      return
    }
    const id = uuidv4()
    const ts = nowTs()
    const payloadJson = jsonMissionTemplatePayload(v.payload)
    try {
      await db
        .prepare(
          `INSERT INTO amr_mission_templates (id, name, payload_json, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, nameRaw, payloadJson, req.user!.id, ts, ts)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/UNIQUE|unique/i.test(msg)) {
        res.status(409).json({ error: 'A template with this name already exists' })
        return
      }
      throw e
    }
    res.status(201).json({
      id,
      name: nameRaw,
      payload: v.payload,
      createdAt: ts,
      updatedAt: ts,
    })
  })
)

router.put(
  '/dc/mission-templates/:id',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : ''
    if (!id) {
      res.status(400).json({ error: 'template id required' })
      return
    }
    const existing = (await db.prepare('SELECT id, name, payload_json FROM amr_mission_templates WHERE id = ?').get(id)) as
      | { id: string; name: string; payload_json: string }
      | undefined
    if (!existing) {
      res.status(404).json({ error: 'Template not found' })
      return
    }
    const b = req.body as Record<string, unknown>
    let nextName = existing.name
    if (b.name !== undefined) {
      if (typeof b.name !== 'string' || !b.name.trim()) {
        res.status(400).json({ error: 'name must be a non-empty string' })
        return
      }
      nextName = b.name.trim()
    }
    let nextPayload: AmrMissionTemplatePayloadV1
    if (b.payload !== undefined) {
      const v = validateMissionTemplatePayload(b.payload)
      if (!v.ok) {
        res.status(400).json({ error: v.error })
        return
      }
      nextPayload = v.payload
    } else {
      const parsed = JSON.parse(existing.payload_json)
      const v = validateMissionTemplatePayload(parsed)
      if (!v.ok) {
        res.status(500).json({ error: `Stored template invalid: ${v.error}` })
        return
      }
      nextPayload = v.payload
    }
    if (nextName !== existing.name) {
      const dupe = (await db
        .prepare('SELECT id FROM amr_mission_templates WHERE LOWER(name) = LOWER(?) AND id != ?')
        .get(nextName, id)) as { id: string } | undefined
      if (dupe) {
        res.status(409).json({ error: 'A template with this name already exists' })
        return
      }
    }
    if (b.payload !== undefined) {
      const tmplLegs: StandLegToValidate[] = nextPayload.legs.map((leg, i) => ({
        position: leg.position,
        putDown: i === 0 ? false : i === nextPayload.legs.length - 1 ? true : Boolean(leg.putDown),
      }))
      const overrideRequested = b.override === true || b.override === 'true'
      const hasOverridePerm = roleHasPermission(
        req.user?.permissions ?? [],
        'amr.stands.override-special'
      )
      const blockCheck = await validateStandBlocksForLegs(tmplLegs, overrideRequested, hasOverridePerm)
      if (!blockCheck.ok) {
        res.status(blockCheck.status).json({ error: blockCheck.error })
        return
      }
    }
    const ts = nowTs()
    const payloadJson = JSON.stringify(nextPayload)
    try {
      await db
        .prepare(`UPDATE amr_mission_templates SET name = ?, payload_json = ?, updated_at = ? WHERE id = ?`)
        .run(nextName, payloadJson, ts, id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/UNIQUE|unique/i.test(msg)) {
        res.status(409).json({ error: 'A template with this name already exists' })
        return
      }
      throw e
    }
    res.json({ id, name: nextName, payload: nextPayload, updatedAt: ts })
  })
)

router.delete(
  '/dc/mission-templates/:id',
  authMiddleware,
  requirePermission('amr.missions.manage'),
  asyncRoute(async (req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : ''
    if (!id) {
      res.status(400).json({ error: 'template id required' })
      return
    }
    const r = await db.prepare('DELETE FROM amr_mission_templates WHERE id = ?').run(id)
    if (!r.changes) {
      res.status(404).json({ error: 'Template not found' })
      return
    }
    res.json({ ok: true })
  })
)

export { router as amrRouter }
