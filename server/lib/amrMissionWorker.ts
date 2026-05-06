import { v4 as uuidv4 } from 'uuid'
import type { AsyncDbWrapper } from '../db/schema.js'
import { getAmrFleetConfig } from './amrConfig.js'
import { formatLogRecordedAt } from './hostTimeZone.js'
import { executeMultistopContinue } from './amrMultistopContinue.js'
import { computeContinueDeadlineIso, parseMultistopPlan, robotIdFromFleetJob } from './amrMultistop.js'
import { fleetJsonIndicatesSuccess, forwardAmrFleetRequest } from './amrFleet.js'

/** Job status codes from KUKA docs — terminal states stop worker polling. */
const TERMINAL_JOB_STATUS = new Set([30, 31, 35, 50, 60])
/** Fleet-reported success — only these set `finalized` (business “complete”). Warning/cancel/error close tracking without that flag. */
const FINALIZED_SUCCESS_STATUS = new Set([30, 35])
/** Successful completion states — both trigger optional containerOut when not persistent (same as fleet “done”). */
const CONTAINER_OUT_TRIGGER_STATUS = new Set([30, 35])
/**
 * Fleet states that close the segment’s mission row (`worker_closed`) but still move the multistop session to
 * `awaiting_continue` / `completed` like a successful leg. **50 Warning** often still allows the route to proceed;
 * without this, we marked the session `failed` and Continue returned 409.
 */
const MULTISTOP_SESSION_ADVANCE_STATUS = new Set([...FINALIZED_SUCCESS_STATUS, 50])

/** Must match `mergeConfig` floor for `pollMsMissionWorker` in {@link amrConfig.ts}. */
const MIN_POLL_MS_MISSION_WORKER = 1000

let missionWorkerReschedule: (() => void) | null = null

/** Re-read fleet config and reset the `jobQuery` interval (call after saving AMR settings). */
export function rescheduleAmrMissionWorker(): void {
  missionWorkerReschedule?.()
}

function missionPayloadToString(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw != null && typeof raw === 'object') return JSON.stringify(raw)
  return ''
}

function parseMissionFinalPosition(payloadJson: string): string | null {
  if (!payloadJson.trim()) return null
  try {
    const o = JSON.parse(payloadJson) as {
      submit?: { missionData?: Array<{ sequence?: number; position?: string }> }
      missionData?: Array<{ sequence?: number; position?: string }>
    }
    const md = o.submit?.missionData ?? o.missionData
    if (!Array.isArray(md) || md.length === 0) return null
    const sorted = [...md].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    const last = sorted[sorted.length - 1]
    return typeof last?.position === 'string' ? last.position : null
  } catch {
    return null
  }
}

/** Last route node — payload first, then column stored at mission creation (never use container_code as position). */
function resolveFinalPosition(row: {
  mission_payload_json: unknown
  final_position?: string | null
}): string {
  const fromPayload = parseMissionFinalPosition(missionPayloadToString(row.mission_payload_json))
  if (fromPayload?.trim()) return fromPayload.trim()
  const fp = row.final_position
  if (typeof fp === 'string' && fp.trim()) return fp.trim()
  return ''
}

export function startAmrMissionWorker(db: AsyncDbWrapper): () => void {
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const cfg = await getAmrFleetConfig(db)
      if (!cfg.serverIp?.trim() || !cfg.authKey?.trim()) return

      const open = (await db
        .prepare(
          `SELECT * FROM amr_mission_records WHERE COALESCE(worker_closed, 0) = 0 ORDER BY created_at ASC LIMIT 50`
        )
        .all()) as Array<{
        id: string
        job_code: string
        mission_payload_json: unknown
        final_position?: string | null
        persistent_container: number
        container_out_done: number
        container_code: string | null
        last_status: number | null
        locked_robot_id?: string | null
        multistop_session_id?: string | null
        multistop_step_index?: number | null
      }>

      for (const row of open) {
        const fr = await forwardAmrFleetRequest(cfg, 'jobQuery', { jobCode: row.job_code }, {
          db,
          source: 'mission-worker',
          missionRecordId: row.id,
        })
        if (!fr.ok || fr.status >= 400) continue

        const body = fr.json as { success?: boolean; data?: Array<Record<string, unknown>> }
        const job = Array.isArray(body.data) && body.data.length > 0 ? body.data[0] : null
        const status = job && typeof job.status === 'number' ? job.status : undefined
        if (typeof status !== 'number') continue

        if (row.last_status !== status) {
          const recordedAt = formatLogRecordedAt()
          const updatedAt = new Date().toISOString()
          await db
            .prepare(
              `INSERT INTO amr_mission_status_log (id, mission_record_id, job_status, raw_json, recorded_at)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(uuidv4(), row.id, status, JSON.stringify(job), recordedAt)
          await db
            .prepare(`UPDATE amr_mission_records SET last_status = ?, updated_at = ? WHERE id = ?`)
            .run(status, updatedAt, row.id)
        }

        const ridFromJob = job ? robotIdFromFleetJob(job) : ''
        const prevRid =
          typeof row.locked_robot_id === 'string' ? row.locked_robot_id.trim() : ''
        if (ridFromJob && ridFromJob !== prevRid) {
          const updatedAtRobot = new Date().toISOString()
          await db
            .prepare(`UPDATE amr_mission_records SET locked_robot_id = ?, updated_at = ? WHERE id = ?`)
            .run(ridFromJob, updatedAtRobot, row.id)
        }

        const persistent = Number(row.persistent_container) === 1
        const outDone = Number(row.container_out_done) === 1
        const finalPos = resolveFinalPosition(row)
        const containerCode = typeof row.container_code === 'string' ? row.container_code.trim() : ''

        let skipContainerOutMultistop = false
        const msId = typeof row.multistop_session_id === 'string' ? row.multistop_session_id.trim() : ''
        const stepIdxRaw = row.multistop_step_index
        const stepIdx = typeof stepIdxRaw === 'number' ? stepIdxRaw : Number(stepIdxRaw)
        if (msId && Number.isFinite(stepIdx)) {
          const sess = (await db.prepare('SELECT total_segments FROM amr_multistop_sessions WHERE id = ?').get(msId)) as
            | { total_segments?: number }
            | undefined
          const ts = Number(sess?.total_segments)
          if (Number.isFinite(ts) && stepIdx < ts - 1) skipContainerOutMultistop = true
        }

        if (
          CONTAINER_OUT_TRIGGER_STATUS.has(status) &&
          !persistent &&
          !outDone &&
          containerCode &&
          finalPos &&
          !skipContainerOutMultistop
        ) {
          const outReq: Record<string, unknown> = {
            orgId: cfg.orgId,
            requestId: `DCA-CO-${uuidv4().slice(0, 8)}`,
            containerType: cfg.containerType,
            containerModelCode: cfg.containerModelCode,
            containerCode,
            position: finalPos,
            enterOrientation: '0',
            isDelete: true,
          }
          const out = await forwardAmrFleetRequest(cfg, 'containerOut', outReq, {
            db,
            source: 'mission-worker',
            missionRecordId: row.id,
          })
          const accepted = out.ok && fleetJsonIndicatesSuccess(out.json)
          if (!accepted) {
            console.warn(
              `[amr-mission-worker] containerOut failed for job ${row.job_code}: HTTP ${out.status}`,
              out.json
            )
          } else {
            const ts = new Date().toISOString()
            await db
              .prepare(`UPDATE amr_mission_records SET container_out_done = 1, updated_at = ? WHERE id = ?`)
              .run(ts, row.id)
          }
        }

        if (TERMINAL_JOB_STATUS.has(status)) {
          const ts = new Date().toISOString()
          const finalized = FINALIZED_SUCCESS_STATUS.has(status) ? 1 : 0
          await db
            .prepare(
              `UPDATE amr_mission_records SET worker_closed = 1, finalized = ?, updated_at = ? WHERE id = ?`
            )
            .run(finalized, ts, row.id)

          if (msId && Number.isFinite(stepIdx) && job) {
            const sessRow = (await db.prepare('SELECT total_segments FROM amr_multistop_sessions WHERE id = ?').get(msId)) as
              | { total_segments?: number }
              | undefined
            const totalSeg = Number(sessRow?.total_segments)
            if (Number.isFinite(totalSeg)) {
              const advanceSession = MULTISTOP_SESSION_ADVANCE_STATUS.has(status)
              const rid = robotIdFromFleetJob(job)
              if (advanceSession && stepIdx < totalSeg - 1) {
                const planRow = (await db.prepare('SELECT plan_json FROM amr_multistop_sessions WHERE id = ?').get(msId)) as
                  | { plan_json?: string }
                  | undefined
                const plan = parseMultistopPlan(JSON.parse(String(planRow?.plan_json || '{}')))
                const continueNotBefore =
                  plan != null ? computeContinueDeadlineIso(plan, stepIdx, Date.parse(ts)) : null
                await db
                  .prepare(
                    `UPDATE amr_multistop_sessions SET status = ?, locked_robot_id = ?, continue_not_before = ?, updated_at = ? WHERE id = ?`
                  )
                  .run('awaiting_continue', rid || null, continueNotBefore, ts, msId)
              } else if (advanceSession && stepIdx === totalSeg - 1) {
                await db
                  .prepare(`UPDATE amr_multistop_sessions SET status = ?, updated_at = ? WHERE id = ?`)
                  .run('completed', ts, msId)
              } else if (!advanceSession) {
                await db
                  .prepare(`UPDATE amr_multistop_sessions SET status = ?, updated_at = ? WHERE id = ?`)
                  .run('failed', ts, msId)
              }
            }
          }
        }
      }

      const nowIso = new Date().toISOString()
      const due = (await db
        .prepare(
          `SELECT id, created_by FROM amr_multistop_sessions
           WHERE status = 'awaiting_continue' AND continue_not_before IS NOT NULL AND continue_not_before <= ?
           LIMIT 20`
        )
        .all(nowIso)) as Array<{ id: string; created_by?: string | null }>
      for (const s of due) {
        const sid = typeof s.id === 'string' ? s.id.trim() : ''
        if (!sid) continue
        const uid = typeof s.created_by === 'string' && s.created_by.trim() ? s.created_by.trim() : null
        const result = await executeMultistopContinue({
          db,
          cfg,
          sessionId: sid,
          userId: uid,
          source: 'multistop-auto-continue',
        })
        if (!result.ok) {
          if (result.status === 409) {
            // Occupied destination (or business rule): stop auto timer; operator must Continue manually after clearing.
            await db
              .prepare(
                `UPDATE amr_multistop_sessions SET continue_not_before = NULL, updated_at = ? WHERE id = ? AND status = 'awaiting_continue'`
              )
              .run(nowIso, sid)
            continue
          }
          console.warn(
            `[amr-mission-worker] multistop auto-continue failed for session ${sid}: ${result.error}`,
            result.status
          )
          if (result.status !== 404) {
            await db
              .prepare(
                `UPDATE amr_multistop_sessions SET continue_not_before = NULL, updated_at = ? WHERE id = ? AND status = 'awaiting_continue'`
              )
              .run(nowIso, sid)
          }
        }
      }
    } finally {
      running = false
    }
  }

  const schedule = async () => {
    const cfg = await getAmrFleetConfig(db)
    const ms = Math.max(MIN_POLL_MS_MISSION_WORKER, cfg.pollMsMissionWorker || 5000)
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      void tick()
    }, ms)
    void tick()
  }

  missionWorkerReschedule = () => {
    void schedule()
  }

  void schedule()

  return () => {
    if (timer) clearInterval(timer)
    missionWorkerReschedule = null
  }
}
