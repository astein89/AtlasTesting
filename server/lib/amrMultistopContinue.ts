import { v4 as uuidv4 } from 'uuid'
import type { AsyncDbWrapper } from '../db/schema.js'
import type { AmrFleetConfig } from './amrConfig.js'
import { fleetJsonIndicatesSuccess, forwardAmrFleetRequest } from './amrFleet.js'
import {
  buildSegmentMissionData,
  multistopSegmentDropDestinationRef,
  parseMultistopPlan,
  robotIdFromFleetJob,
} from './amrMultistop.js'
import { fetchStandPresenceFromHyperion } from './amrStandPresence.js'
import { getAmrHyperionConfig, hyperionConfigured } from './hyperionConfig.js'

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
  | { ok: false; status: number; error: string; json?: unknown; standOccupiedRef?: string }

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

  if (cfg.missionCreateStandPresenceSanityCheck && !skipStandPresenceCheck) {
    const destRef = multistopSegmentDropDestinationRef(plan, next_segment_index)
    if (destRef) {
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
      if (pr.presence[destRef] === true) {
        return {
          ok: false,
          status: 409,
          error: `Pallet present on stand ${destRef}. Unable to dispatch.`,
          standOccupiedRef: destRef,
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
  const submitPayload = {
    orgId: cfg.orgId,
    requestId: missionCode,
    missionCode,
    missionType: 'RACK_MOVE',
    robotType: cfg.robotType,
    lockRobotAfterFinish,
    unlockRobotId,
    robotModels: cfg.robotModels,
    robotIds: (() => {
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
    })(),
    missionData,
    ...(sessionContainerCode ? { containerCode: sessionContainerCode } : {}),
  }
  const missionRecordId = uuidv4()
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
      `UPDATE amr_multistop_sessions SET status = ?, next_segment_index = ?, locked_robot_id = NULL, continue_not_before = NULL, updated_at = ? WHERE id = ?`
    )
    .run('active', nextAfter, ts, sessionId)
  return {
    ok: true,
    missionRecordId,
    missionCode,
    multistopSessionId: sessionId,
    next_segment_index: nextAfter,
    fleetSubmit: sm.json,
  }
}
