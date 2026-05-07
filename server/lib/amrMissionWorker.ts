import { v4 as uuidv4 } from 'uuid'
import type { AsyncDbWrapper } from '../db/schema.js'
import { getAmrFleetConfig } from './amrConfig.js'
import { formatLogRecordedAt } from './hostTimeZone.js'
import { executeMultistopContinue } from './amrMultistopContinue.js'
import { computeContinueDeadlineIso, parseMultistopPlan, robotIdFromFleetJob } from './amrMultistop.js'
import { fleetJsonIndicatesSuccess, forwardAmrFleetRequest } from './amrFleet.js'
import {
  activeReservationCount,
  getStandQueuePolicy,
  isStandAvailableForDrop,
  releaseReservationsForRecord,
  reserveStandForRecord,
  type StandQueuePolicy,
} from './amrStandAvailability.js'
import { getAmrHyperionConfig, hyperionConfigured } from './hyperionConfig.js'
import { fetchStandPresenceFromHyperion } from './amrStandPresence.js'
import { resolveGroupDestination } from './amrStandGroups.js'
import { externalRefUsesNonStandRow } from './amrStandLocationType.js'

/** Synthetic chip when drop presence deadline passes without confirming pallet cleared (stored in DB, not fleet). */
const PRESENCE_WARNING_STATUS_CODE = 93

/** Fleet job statuses that close this mission row (`worker_closed = 1`) and stop jobQuery polling for it. */
const CLOSE_MISSION_ROW_STATUS = new Set([30, 31, 35])
/** Fleet-reported success — only these set `finalized` (business “complete”). Cancelled closes without that flag. */
const FINALIZED_SUCCESS_STATUS = new Set([30, 35])
/** Terminal states that trigger optional containerOut when not persistent (complete or fleet-cancelled). */
const CONTAINER_OUT_TRIGGER_STATUS = new Set([30, 31, 35])
/**
 * Leg-complete fleet statuses that move the multistop session to `awaiting_continue` / `completed` like success.
 * **30 / 35** also close the mission row (see `CLOSE_MISSION_ROW_STATUS`). **50 Warning** advances the session while the
 * segment row stays open until the fleet reports **30 / 31 / 35**.
 */
const MULTISTOP_SESSION_ADVANCE_STATUS = new Set([...FINALIZED_SUCCESS_STATUS, 50])

async function applyMultistopLegFleetOutcome(
  db: AsyncDbWrapper,
  msId: string,
  stepIdx: number,
  job: Record<string, unknown>,
  tsIso: string,
  status: number
): Promise<void> {
  const sessRow = (await db.prepare('SELECT total_segments FROM amr_multistop_sessions WHERE id = ?').get(msId)) as
    | { total_segments?: number }
    | undefined
  const totalSeg = Number(sessRow?.total_segments)
  if (!Number.isFinite(totalSeg)) return

  const advanceSession = MULTISTOP_SESSION_ADVANCE_STATUS.has(status)
  const rid = robotIdFromFleetJob(job)
  if (advanceSession && stepIdx < totalSeg - 1) {
    const planRow = (await db.prepare('SELECT plan_json FROM amr_multistop_sessions WHERE id = ?').get(msId)) as
      | { plan_json?: string }
      | undefined
    const plan = parseMultistopPlan(JSON.parse(String(planRow?.plan_json || '{}')))
    const continueNotBefore =
      plan != null ? computeContinueDeadlineIso(plan, stepIdx, Date.parse(tsIso)) : null
    await db
      .prepare(
        `UPDATE amr_multistop_sessions SET status = ?, locked_robot_id = ?, continue_not_before = ?, updated_at = ? WHERE id = ?`
      )
      .run('awaiting_continue', rid || null, continueNotBefore, tsIso, msId)
  } else if (advanceSession && stepIdx === totalSeg - 1) {
    await db.prepare(`UPDATE amr_multistop_sessions SET status = ?, updated_at = ? WHERE id = ?`).run('completed', tsIso, msId)
  } else if (!advanceSession) {
    await db.prepare(`UPDATE amr_multistop_sessions SET status = ?, updated_at = ? WHERE id = ?`).run('failed', tsIso, msId)
  }
}

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

function parseMissionEndDropMeta(payloadJson: string): { isDrop: boolean; destinationRef: string } {
  if (!payloadJson.trim()) return { isDrop: false, destinationRef: '' }
  try {
    const o = JSON.parse(payloadJson) as {
      submit?: { missionData?: Array<{ sequence?: number; position?: string; putDown?: boolean }> }
      missionData?: Array<{ sequence?: number; position?: string; putDown?: boolean }>
    }
    const md = o.submit?.missionData ?? o.missionData
    if (!Array.isArray(md) || md.length === 0) return { isDrop: false, destinationRef: '' }
    const sorted = [...md].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    const last = sorted[sorted.length - 1]
    const destinationRef = typeof last?.position === 'string' ? last.position.trim() : ''
    const isDrop = last?.putDown === true
    return { isDrop, destinationRef }
  } catch {
    return { isDrop: false, destinationRef: '' }
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
          `SELECT * FROM amr_mission_records
           WHERE COALESCE(worker_closed, 0) = 0 AND COALESCE(queued, 0) = 0
           ORDER BY created_at ASC LIMIT 50`
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
          /** Intermediate legs skip containerOut on success so the pallet can advance; cancel (31) still peels fleet map. */
          if (Number.isFinite(ts) && stepIdx < ts - 1 && status !== 31) skipContainerOutMultistop = true
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

        if (CLOSE_MISSION_ROW_STATUS.has(status)) {
          const ts = new Date().toISOString()
          const finalized = FINALIZED_SUCCESS_STATUS.has(status) ? 1 : 0
          await db
            .prepare(
              `UPDATE amr_mission_records SET worker_closed = 1, finalized = ?, updated_at = ? WHERE id = ?`
            )
            .run(finalized, ts, row.id)

          if (msId && Number.isFinite(stepIdx) && job) {
            await applyMultistopLegFleetOutcome(db, msId, stepIdx, job, ts, status)
          }
          const endMeta = parseMissionEndDropMeta(missionPayloadToString(row.mission_payload_json))
          const queueingEnabled = cfg.missionQueueingEnabled !== false
          const dropDestRef = typeof endMeta.destinationRef === 'string' ? endMeta.destinationRef.trim() : ''
          const dropPolicy =
            queueingEnabled && FINALIZED_SUCCESS_STATUS.has(status) && endMeta.isDrop && dropDestRef
              ? await getStandQueuePolicy(db, dropDestRef)
              : null
          const bypassFinalPresence = dropPolicy?.bypassPalletCheck === true
          const postDropPresenceOn = cfg.postDropPresenceWarningCheck !== false
          const skipNonStandDropPres =
            Boolean(dropDestRef) && (await externalRefUsesNonStandRow(db, dropDestRef))
          if (
            queueingEnabled &&
            postDropPresenceOn &&
            FINALIZED_SUCCESS_STATUS.has(status) &&
            endMeta.isDrop &&
            dropDestRef &&
            !bypassFinalPresence &&
            !skipNonStandDropPres
          ) {
            const timeoutMs = Math.max(1000, Math.min(600000, Number(cfg.palletDropConfirmTimeoutMs || 10000)))
            const deadline = new Date(Date.now() + timeoutMs).toISOString()
            await db
              .prepare(
                `UPDATE amr_mission_records
                 SET presence_dest_ref = ?, presence_check_until = ?, updated_at = ?
                 WHERE id = ?`
              )
              .run(dropDestRef, deadline, ts, row.id)
          } else {
            await releaseReservationsForRecord(db, row.id)
          }
        } else if (
          status === 50 &&
          msId &&
          Number.isFinite(stepIdx) &&
          job &&
          MULTISTOP_SESSION_ADVANCE_STATUS.has(50)
        ) {
          /** Warning (50): advance multistop like success but do not close the mission row (only 30/31/35 do). */
          const sessRow = (await db.prepare('SELECT status FROM amr_multistop_sessions WHERE id = ?').get(msId)) as
            | { status?: string }
            | undefined
          if (String(sessRow?.status ?? '') === 'active') {
            const ts = new Date().toISOString()
            await applyMultistopLegFleetOutcome(db, msId, stepIdx, job, ts, 50)
          }
        }
      }

      if (cfg.missionQueueingEnabled !== false) {
        const queuedRows = (await db
          .prepare(
            `SELECT * FROM amr_mission_records
             WHERE COALESCE(queued, 0) = 1
             ORDER BY COALESCE(queued_at, created_at) ASC
             LIMIT 200`
          )
          .all()) as Array<Record<string, unknown>>
        const headsByDestination = new Map<string, Record<string, unknown>>()
        const headsByGroup = new Map<string, Record<string, unknown>>()
        for (const r of queuedRows) {
          const ref = typeof r.queued_destination_ref === 'string' ? r.queued_destination_ref.trim() : ''
          if (ref && !headsByDestination.has(ref)) headsByDestination.set(ref, r)
          const gid = typeof r.queued_group_id === 'string' ? r.queued_group_id.trim() : ''
          if (gid && !headsByGroup.has(gid)) headsByGroup.set(gid, r)
        }
        const hcfg = await getAmrHyperionConfig(db)
        const presenceCache: Record<string, boolean> = {}
        for (const [ref, row] of headsByDestination.entries()) {
          const policyRow = await getStandQueuePolicy(db, ref)
          const policy: StandQueuePolicy = policyRow ?? {
            bypassPalletCheck: false,
            activeMissions: 1,
          }
          let palletPresent = false
          if (!policy.bypassPalletCheck && !(await externalRefUsesNonStandRow(db, ref))) {
            if (!hyperionConfigured(hcfg)) continue
            if (!(ref in presenceCache)) {
              const pr = await fetchStandPresenceFromHyperion(hcfg, [ref], {
                db,
                source: 'mission-worker-queue-dispatch',
              })
              if (!pr.ok) continue
              presenceCache[ref] = pr.presence[ref] === true
            }
            palletPresent = presenceCache[ref] === true
          }
          const reservations = await activeReservationCount(db, ref)
          const available = isStandAvailableForDrop({
            palletPresent,
            policy,
            activeReservations: reservations,
          })
          if (!available) continue
          const id = typeof row.id === 'string' ? row.id : ''
          if (!id) continue
          const ciRaw = typeof row.container_in_payload_json === 'string' ? row.container_in_payload_json.trim() : ''
          if (ciRaw) {
            let ciPayload: unknown
            try {
              ciPayload = JSON.parse(ciRaw)
            } catch {
              continue
            }
            const ci = await forwardAmrFleetRequest(cfg, 'containerIn', ciPayload, {
              db,
              source: 'mission-worker-queue-dispatch',
              missionRecordId: id,
            })
            if (!ci.ok || !fleetJsonIndicatesSuccess(ci.json)) continue
            await db
              .prepare(`UPDATE amr_mission_records SET container_in_payload_json = NULL, updated_at = ? WHERE id = ?`)
              .run(new Date().toISOString(), id)
          }
          const submitRaw = typeof row.submit_payload_json === 'string' ? row.submit_payload_json.trim() : ''
          if (!submitRaw) continue
          let submitPayload: unknown
          try {
            submitPayload = JSON.parse(submitRaw)
          } catch {
            continue
          }
          const sm = await forwardAmrFleetRequest(cfg, 'submitMission', submitPayload, {
            db,
            source: 'mission-worker-queue-dispatch',
            missionRecordId: id,
          })
          if (!sm.ok || !fleetJsonIndicatesSuccess(sm.json)) continue
          const ts = new Date().toISOString()
          await db
            .prepare(
              `UPDATE amr_mission_records
               SET queued = 0, queued_destination_ref = NULL, queued_at = NULL, submit_payload_json = NULL, last_status = NULL, updated_at = ?
               WHERE id = ?`
            )
            .run(ts, id)
          await reserveStandForRecord(db, ref, id, {
            multistopSessionId:
              typeof row.multistop_session_id === 'string' ? row.multistop_session_id : null,
            multistopStepIndex: typeof row.multistop_step_index === 'number' ? row.multistop_step_index : null,
          })
        }

        for (const [gid, row] of headsByGroup.entries()) {
          const rr = await resolveGroupDestination({
            db,
            hcfg,
            groupId: gid,
            userId: null,
            source: 'mission-worker-queue-dispatch-group',
          })
          if (!rr.ok) continue
          const id = typeof row.id === 'string' ? row.id : ''
          if (!id) continue
          const ciRaw = typeof row.container_in_payload_json === 'string' ? row.container_in_payload_json.trim() : ''
          if (ciRaw) {
            let ciPayload: unknown
            try {
              ciPayload = JSON.parse(ciRaw)
            } catch {
              continue
            }
            const ci = await forwardAmrFleetRequest(cfg, 'containerIn', ciPayload, {
              db,
              source: 'mission-worker-queue-dispatch',
              missionRecordId: id,
            })
            if (!ci.ok || !fleetJsonIndicatesSuccess(ci.json)) continue
            await db
              .prepare(`UPDATE amr_mission_records SET container_in_payload_json = NULL, updated_at = ? WHERE id = ?`)
              .run(new Date().toISOString(), id)
          }
          const submitRaw = typeof row.submit_payload_json === 'string' ? row.submit_payload_json.trim() : ''
          if (!submitRaw) continue
          let submitPayload: Record<string, unknown>
          try {
            submitPayload = JSON.parse(submitRaw) as Record<string, unknown>
          } catch {
            continue
          }
          const md = submitPayload.missionData
          if (Array.isArray(md) && md.length >= 2) {
            const last = md[md.length - 1] as Record<string, unknown>
            last.position = rr.externalRef
          }
          const sm = await forwardAmrFleetRequest(cfg, 'submitMission', submitPayload, {
            db,
            source: 'mission-worker-queue-dispatch',
            missionRecordId: id,
          })
          if (!sm.ok || !fleetJsonIndicatesSuccess(sm.json)) continue
          const ts = new Date().toISOString()
          await db
            .prepare(
              `UPDATE amr_mission_records
               SET queued = 0, queued_destination_ref = NULL, queued_group_id = NULL, queued_at = NULL, submit_payload_json = NULL, last_status = NULL, updated_at = ?
               WHERE id = ?`
            )
            .run(ts, id)
          await reserveStandForRecord(db, rr.externalRef, id, {
            multistopSessionId:
              typeof row.multistop_session_id === 'string' ? row.multistop_session_id : null,
            multistopStepIndex: typeof row.multistop_step_index === 'number' ? row.multistop_step_index : null,
          })
        }

        const checks = (await db
          .prepare(
            `SELECT id, presence_dest_ref, presence_check_until
             FROM amr_mission_records
             WHERE presence_check_until IS NOT NULL
               AND presence_seen_at IS NULL
               AND presence_warning_at IS NULL
             LIMIT 200`
          )
          .all()) as Array<{ id: string; presence_dest_ref?: string | null; presence_check_until?: string | null }>
        const hcfgChecks = await getAmrHyperionConfig(db)
        if (hyperionConfigured(hcfgChecks)) {
          for (const row of checks) {
            const ref = typeof row.presence_dest_ref === 'string' ? row.presence_dest_ref.trim() : ''
            if (!ref) continue
            const finalizePolicy = await getStandQueuePolicy(db, ref)
            const nonStandPres = await externalRefUsesNonStandRow(db, ref)
            if (finalizePolicy?.bypassPalletCheck === true || nonStandPres) {
              const tsBypass = new Date().toISOString()
              await db
                .prepare(
                  `UPDATE amr_mission_records
                   SET presence_seen_at = ?, presence_check_until = NULL, updated_at = ?
                   WHERE id = ?`
                )
                .run(tsBypass, tsBypass, row.id)
              await releaseReservationsForRecord(db, row.id)
              continue
            }
            const pr = await fetchStandPresenceFromHyperion(hcfgChecks, [ref], {
              db,
              source: 'mission-worker-presence-confirm',
            })
            if (!pr.ok) continue
            const ts = new Date().toISOString()
            if (pr.presence[ref] === true) {
              await db
                .prepare(
                  `UPDATE amr_mission_records
                   SET presence_seen_at = ?, presence_check_until = NULL, updated_at = ?
                   WHERE id = ?`
                )
                .run(ts, ts, row.id)
              await releaseReservationsForRecord(db, row.id)
              continue
            }
            const deadline = typeof row.presence_check_until === 'string' ? Date.parse(row.presence_check_until) : NaN
            if (Number.isFinite(deadline) && Date.now() >= deadline) {
              await db
                .prepare(
                  `UPDATE amr_mission_records
                   SET presence_warning_at = ?, presence_check_until = NULL, last_status = ?, updated_at = ?
                   WHERE id = ?`
                )
                .run(ts, PRESENCE_WARNING_STATUS_CODE, ts, row.id)
            }
          }
        }
      }

      const nowIso = new Date().toISOString()
      const groupDue = (await db
        .prepare(
          `SELECT id, created_by FROM amr_multistop_sessions
           WHERE status = 'awaiting_continue'
             AND queue_blocked_group_id IS NOT NULL
             AND (queue_blocked_until IS NULL OR queue_blocked_until <= ?)
           LIMIT 10`
        )
        .all(nowIso)) as Array<{ id: string; created_by?: string | null }>
      for (const s of groupDue) {
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
        if (!result.ok && result.status !== 404) {
          console.warn(`[amr-mission-worker] group-blocked continue retry ${sid}: ${result.error}`)
        }
      }

      const due = (await db
        .prepare(
          `SELECT id, created_by FROM amr_multistop_sessions
           WHERE status = 'awaiting_continue'
             AND continue_not_before IS NOT NULL
             AND continue_not_before <= ?
             AND (queue_blocked_until IS NULL OR queue_blocked_until <= ?)
           LIMIT 20`
        )
        .all(nowIso, nowIso)) as Array<{ id: string; created_by?: string | null }>
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
          if (result.status === 409 && result.code === 'NO_UNLOCKED_ROBOTS') {
            /** All-locked stall: keep `continue_not_before` so the next tick auto-retries once an unlock happens. */
            console.warn(
              `[amr-mission-worker] multistop auto-continue stalled for session ${sid}: ${result.error}`
            )
            continue
          }
          if (result.status === 409) {
            if ((result as { queued?: boolean }).queued) continue
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
