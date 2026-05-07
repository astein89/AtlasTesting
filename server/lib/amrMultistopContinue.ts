import { v4 as uuidv4 } from 'uuid'
import type { AsyncDbWrapper } from '../db/schema.js'
import type { AmrFleetConfig } from './amrConfig.js'
import { fleetJsonIndicatesSuccess, forwardAmrFleetRequest } from './amrFleet.js'
import {
  buildSegmentMissionData,
  multistopSegmentDropGate,
  parseMultistopPlan,
  robotIdFromFleetJob,
} from './amrMultistop.js'
import { resolveGroupDestination } from './amrStandGroups.js'
import { externalRefsBypassingPalletCheck } from './amrStandBypass.js'
import { externalRefsNonStandLocation } from './amrStandLocationType.js'
import { fetchStandPresenceFromHyperion } from './amrStandPresence.js'
import { getAmrHyperionConfig, hyperionConfigured } from './hyperionConfig.js'
import { getLockedRobotIds, resolveActiveUnlockedRobotIds } from './amrRobots.js'
import {
  activeReservationCount,
  getStandQueuePolicy,
  isStandAvailableForDrop,
  reserveStandForRecord,
} from './amrStandAvailability.js'

export function multistopSegmentMissionCode(baseMissionCode: string, segmentIndex: number): string {
  return `${baseMissionCode.trim()}-${segmentIndex + 1}`
}

function genDCA(kind: string): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const r = uuidv4().replace(/-/g, '').slice(0, 8)
  return `DCA-${kind}-${y}${m}${day}-${r}`
}

export async function resolveMultistopBaseMissionCode(
  db: AsyncDbWrapper,
  row: Record<string, unknown>,
  sessionId: string
): Promise<string> {
  const stored = row.base_mission_code
  if (typeof stored === 'string' && stored.trim()) return stored.trim()
  const prev = (await db
    .prepare(
      `SELECT job_code, multistop_step_index FROM amr_mission_records
       WHERE multistop_session_id = ?
       ORDER BY multistop_step_index ASC, created_at ASC LIMIT 1`
    )
    .get(sessionId)) as { job_code?: string; multistop_step_index?: number | null } | undefined
  const jc = typeof prev?.job_code === 'string' ? prev.job_code.trim() : ''
  if (!jc) return genDCA('RM')
  const step = Number(prev?.multistop_step_index)
  const si = Number.isFinite(step) ? step : 0
  const m = jc.match(/^(.*)-([1-9]\d{0,2})$/)
  if (m && Number(m[2]) === si + 1) return m[1]
  return jc
}

export async function resolveUnlockRobotId(
  cfg: AmrFleetConfig,
  db: AsyncDbWrapper,
  session: {
    id: string
    locked_robot_id: string | null
    next_segment_index: number
  }
): Promise<string> {
  const fromSession = typeof session.locked_robot_id === 'string' ? session.locked_robot_id.trim() : ''
  if (fromSession) return fromSession
  const step = session.next_segment_index
  if (step < 1) return ''
  const prev = (await db
    .prepare(
      `SELECT job_code FROM amr_mission_records
       WHERE multistop_session_id = ? AND multistop_step_index = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(session.id, step - 1)) as { job_code?: string } | undefined
  const jc = typeof prev?.job_code === 'string' ? prev.job_code.trim() : ''
  if (!jc) return ''
  const fr = await forwardAmrFleetRequest(cfg, 'jobQuery', { jobCode: jc }, { db, source: 'multistop-continue' })
  if (!fr.ok || fr.status >= 400) return ''
  const body = fr.json as { data?: Array<Record<string, unknown>> }
  const job = Array.isArray(body.data) && body.data.length > 0 ? body.data[0] : null
  if (!job) return ''
  return robotIdFromFleetJob(job)
}

export type MultistopContinueSource = 'multistop-continue' | 'multistop-auto-continue'

export type ExecuteMultistopContinueResult =
  | {
      ok: true
      missionRecordId: string
      missionCode: string
      multistopSessionId: string
      next_segment_index: number
      fleetSubmit: unknown
    }
  | {
      ok: false
      status: number
      error: string
      json?: unknown
      standOccupiedRef?: string
      /** Stable identifier so the client can branch on the all-locked case (HTTP 409). */
      code?: 'NO_UNLOCKED_ROBOTS' | 'STAND_OCCUPIED'
      queued?: boolean
    }

export async function executeMultistopContinue(params: {
  db: AsyncDbWrapper
  cfg: AmrFleetConfig
  sessionId: string
  userId: string | null
  source: MultistopContinueSource
  /** When set (manual continue only), skip Hyperion stand-empty verification. */
  skipStandPresenceCheck?: boolean
}): Promise<ExecuteMultistopContinueResult> {
  const { db, cfg, sessionId, userId, source, skipStandPresenceCheck } = params
  const row = (await db.prepare('SELECT * FROM amr_multistop_sessions WHERE id = ?').get(sessionId)) as
    | Record<string, unknown>
    | undefined
  if (!row) {
    return { ok: false, status: 404, error: 'Session not found' }
  }
  if (String(row.status) !== 'awaiting_continue') {
    return { ok: false, status: 409, error: 'Session is not waiting for continue' }
  }
  const next_segment_index = Number(row.next_segment_index)
  const total_segments = Number(row.total_segments)
  if (!Number.isFinite(next_segment_index) || !Number.isFinite(total_segments) || next_segment_index >= total_segments) {
    return { ok: false, status: 409, error: 'No remaining segments' }
  }
  const plan = parseMultistopPlan(JSON.parse(String(row.plan_json || '{}')))
  if (!plan) {
    return { ok: false, status: 500, error: 'Invalid session plan' }
  }

  const gate0 = multistopSegmentDropGate(plan, next_segment_index)
  if (gate0?.kind === 'group') {
    const hcfg = await getAmrHyperionConfig(db)
    const resolved = await resolveGroupDestination({
      db,
      hcfg,
      groupId: gate0.groupId,
      userId,
      source: 'multistop-continue-resolve-group',
      ignorePresence: Boolean(skipStandPresenceCheck),
    })
    if (resolved.ok === false) {
      if (resolved.reason === 'empty_group') {
        return { ok: false, status: 400, error: 'Stand group has no enabled members.' }
      }
      if (resolved.reason === 'hyperion_unavailable') {
        return { ok: false, status: 503, error: resolved.message ?? 'Hyperion unavailable for group resolve.' }
      }
      if (cfg.missionQueueingEnabled !== false) {
        const ts = new Date().toISOString()
        const queueBlockedUntil = new Date(Date.now() + Math.max(1000, cfg.pollMsMissionWorker || 5000)).toISOString()
        await db
          .prepare(
            `UPDATE amr_multistop_sessions
             SET queue_blocked_until = ?, queue_blocked_group_id = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(queueBlockedUntil, gate0.groupId, ts, sessionId)
        return {
          ok: false,
          status: 409,
          error: 'No stand available in the selected group. Mission queued.',
          standOccupiedRef: '',
          code: 'STAND_OCCUPIED',
          queued: true,
        }
      }
      return {
        ok: false,
        status: 409,
        error: 'No stand available in the selected group.',
        standOccupiedRef: '',
        code: 'STAND_OCCUPIED',
      }
    }
    plan.destinations[next_segment_index].position = resolved.externalRef
    delete plan.destinations[next_segment_index].groupId
    await db
      .prepare(`UPDATE amr_multistop_sessions SET plan_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(plan), new Date().toISOString(), sessionId)
  }

  /** Block automatic Continue while another mission holds this drop stand — unless operator force-releases (skip presence). */
  if (!skipStandPresenceCheck) {
    const reservationGate = multistopSegmentDropGate(plan, next_segment_index)
    const reservationDestRef =
      reservationGate?.kind === 'stand' ? reservationGate.ref.trim() : ''
    if (reservationDestRef) {
      const nonStandSet = await externalRefsNonStandLocation(db, [reservationDestRef])
      if (!nonStandSet.has(reservationDestRef)) {
        const rc = await activeReservationCount(db, reservationDestRef)
        if (rc > 0) {
          const ts = new Date().toISOString()
          const queueBlockedUntil = new Date(
            Date.now() + Math.max(1000, cfg.pollMsMissionWorker || 5000)
          ).toISOString()
          const msg = `Drop stand ${reservationDestRef} has an active reservation — cannot dispatch yet.`
          if (cfg.missionQueueingEnabled !== false) {
            await db
              .prepare(
                `UPDATE amr_multistop_sessions
               SET queue_blocked_until = ?, queue_blocked_group_id = NULL, updated_at = ?
               WHERE id = ?`
              )
              .run(queueBlockedUntil, ts, sessionId)
            return {
              ok: false,
              status: 409,
              error: msg,
              standOccupiedRef: reservationDestRef,
              code: 'STAND_OCCUPIED',
              queued: true,
            }
          }
          return {
            ok: false,
            status: 409,
            error: msg,
            standOccupiedRef: reservationDestRef,
            code: 'STAND_OCCUPIED',
          }
        }
      }
    }
  }

  if (cfg.missionCreateStandPresenceSanityCheck && !skipStandPresenceCheck) {
    const dropGateCheck = multistopSegmentDropGate(plan, next_segment_index)
    const destRef = dropGateCheck?.kind === 'stand' ? dropGateCheck.ref : ''
    if (destRef) {
      const policy = await getStandQueuePolicy(db, destRef)
      const bypassSet = await externalRefsBypassingPalletCheck(db, [destRef])
      const nonStandSet = await externalRefsNonStandLocation(db, [destRef])
      const bypass =
        bypassSet.has(destRef) ||
        policy?.bypassPalletCheck === true ||
        nonStandSet.has(destRef)
      let palletPresent = false
      if (!bypass) {
        const hcfg = await getAmrHyperionConfig(db)
        if (!hyperionConfigured(hcfg)) {
          return {
            ok: false,
            status: 503,
            error:
              'Hyperion API is not configured. Cannot verify destination stand is empty before continue.',
          }
        }
        const pr = await fetchStandPresenceFromHyperion(hcfg, [destRef], {
          db,
          source: 'multistop-continue-presence',
          userId: userId ?? undefined,
        })
        if (!pr.ok) {
          const st = typeof pr.status === 'number' && pr.status >= 400 && pr.status < 600 ? pr.status : 502
          return { ok: false, status: st, error: pr.message }
        }
        palletPresent = pr.presence[destRef] === true
      }
      const activeReservations = await activeReservationCount(db, destRef)
      const isAvailable = isStandAvailableForDrop({
        palletPresent,
        policy: {
          bypassPalletCheck: bypass,
          activeMissions: policy?.activeMissions ?? 1,
        },
        activeReservations,
      })
      if (!isAvailable) {
        if (cfg.missionQueueingEnabled !== false) {
          const ts = new Date().toISOString()
          const queueBlockedUntil = new Date(Date.now() + Math.max(1000, cfg.pollMsMissionWorker || 5000)).toISOString()
          await db
            .prepare(
              `UPDATE amr_multistop_sessions
               SET queue_blocked_until = ?, queue_blocked_group_id = NULL, updated_at = ?
               WHERE id = ?`
            )
            .run(queueBlockedUntil, ts, sessionId)
          return {
            ok: false,
            status: 409,
            error: `Pallet present on stand ${destRef}. Unable to dispatch.`,
            standOccupiedRef: destRef,
            code: 'STAND_OCCUPIED',
            queued: true,
          }
        }
        return {
          ok: false,
          status: 409,
          error: `Pallet present on stand ${destRef}. Unable to dispatch.`,
          standOccupiedRef: destRef,
          code: 'STAND_OCCUPIED',
        }
      }
    }
  }

  const pickup_position = String(row.pickup_position ?? '')
  let unlockRobotId = ''
  if (next_segment_index > 0) {
    unlockRobotId = await resolveUnlockRobotId(cfg, db, {
      id: sessionId,
      locked_robot_id: typeof row.locked_robot_id === 'string' ? row.locked_robot_id : null,
      next_segment_index,
    })
    if (!unlockRobotId.trim()) {
      return { ok: false, status: 400, error: 'Could not resolve robot id for unlockRobotId (jobQuery)' }
    }
  }
  const baseMissionCode = await resolveMultistopBaseMissionCode(db, row, sessionId)
  const missionCode = multistopSegmentMissionCode(baseMissionCode, next_segment_index)
  const missionData = buildSegmentMissionData(pickup_position, plan, next_segment_index)
  const lockRobotAfterFinish = next_segment_index < total_segments - 1 ? 'true' : 'false'
  const sessionContainerCode =
    typeof row.container_code === 'string' && row.container_code.trim() ? row.container_code.trim() : ''

  /**
   * Re-resolve `robotIds` at execution time so robots locked after session create stop receiving
   * remaining segments. If the session list still drains to empty, fall back to live active-unlocked,
   * then 409 NO_UNLOCKED_ROBOTS so the operator can unlock and retry.
   */
  const sessionRobotIds: string[] = (() => {
    try {
      const rj = row.robot_ids_json
      if (typeof rj === 'string' && rj.trim()) {
        const a = JSON.parse(rj) as unknown
        if (Array.isArray(a)) return a.filter((x): x is string => typeof x === 'string')
      }
    } catch {
      /* ignore */
    }
    return cfg.robotIdsDefault
  })()
  const lockedIds = await getLockedRobotIds(db)
  let resolvedRobotIds = sessionRobotIds
  if (lockedIds.size > 0) {
    if (sessionRobotIds.length > 0) {
      resolvedRobotIds = sessionRobotIds.filter((id) => !lockedIds.has(id))
    }
    if (resolvedRobotIds.length === 0) {
      resolvedRobotIds = await resolveActiveUnlockedRobotIds(cfg, db, { db, source })
    }
    if (resolvedRobotIds.length === 0) {
      return {
        ok: false,
        status: 409,
        error:
          'No unlocked robots available — every active robot is locked. Unlock at least one on the Robots page.',
        code: 'NO_UNLOCKED_ROBOTS',
      }
    }
  }

  const submitPayload = {
    orgId: cfg.orgId,
    requestId: missionCode,
    missionCode,
    missionType: 'RACK_MOVE',
    robotType: cfg.robotType,
    lockRobotAfterFinish,
    unlockRobotId,
    robotModels: cfg.robotModels,
    robotIds: resolvedRobotIds,
    missionData,
    ...(sessionContainerCode ? { containerCode: sessionContainerCode } : {}),
  }
  const missionRecordId = uuidv4()
  if (next_segment_index === 0) {
    const ciPayloadRaw =
      typeof row.container_in_payload_json === 'string' ? row.container_in_payload_json.trim() : ''
    if (ciPayloadRaw) {
      let ciPayload: unknown
      try {
        ciPayload = JSON.parse(ciPayloadRaw)
      } catch {
        return { ok: false, status: 500, error: 'Invalid deferred containerIn payload for session.' }
      }
      const ci = await forwardAmrFleetRequest(cfg, 'containerIn', ciPayload, {
        db,
        source,
        missionRecordId,
        userId: userId ?? undefined,
      })
      if (!ci.ok) return { ok: false, status: ci.status, error: 'Fleet containerIn failed', json: ci.json }
      if (!fleetJsonIndicatesSuccess(ci.json)) {
        return { ok: false, status: 400, error: 'containerIn was rejected by the fleet.', json: ci.json }
      }
      await db
        .prepare(`UPDATE amr_multistop_sessions SET container_in_payload_json = NULL, updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), sessionId)
    }
  }
  const sm = await forwardAmrFleetRequest(cfg, 'submitMission', submitPayload, {
    db,
    source,
    missionRecordId,
    userId: userId ?? undefined,
  })
  if (!sm.ok) {
    return { ok: false, status: sm.status, error: 'Fleet submitMission failed', json: sm.json }
  }
  if (!fleetJsonIndicatesSuccess(sm.json)) {
    return { ok: false, status: 400, error: 'submitMission was rejected by the fleet.', json: sm.json }
  }
  const persistentContainer = Number(row.persistent_container) === 1
  const finalPos = String(plan.destinations[plan.destinations.length - 1]?.position ?? '')
  const ts = new Date().toISOString()
  const nextAfter = next_segment_index + 1
  await db
    .prepare(
      `INSERT INTO amr_mission_records (id, job_code, mission_code, container_code, created_by, mission_type, mission_payload_json, last_status, persistent_container, worker_closed, finalized, container_out_done, final_position, multistop_session_id, multistop_step_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`
    )
    .run(
      missionRecordId,
      missionCode,
      missionCode,
      typeof row.container_code === 'string' ? row.container_code : null,
      userId,
      'RACK_MOVE',
      JSON.stringify({ submit: submitPayload, containerIn: null }),
      null,
      persistentContainer ? 1 : 0,
      finalPos,
      sessionId,
      next_segment_index,
      ts,
      ts
    )
  await db
    .prepare(
      `UPDATE amr_multistop_sessions SET status = ?, next_segment_index = ?, locked_robot_id = NULL, continue_not_before = NULL, queue_blocked_until = NULL, queue_blocked_group_id = NULL, updated_at = ? WHERE id = ?`
    )
    .run('active', nextAfter, ts, sessionId)
  const reserveGate = multistopSegmentDropGate(plan, next_segment_index)
  if (reserveGate?.kind === 'stand') {
    await reserveStandForRecord(db, reserveGate.ref, missionRecordId, {
      multistopSessionId: sessionId,
      multistopStepIndex: next_segment_index,
    })
  }
  return {
    ok: true,
    missionRecordId,
    missionCode,
    multistopSessionId: sessionId,
    next_segment_index: nextAfter,
    fleetSubmit: sm.json,
  }
}
