import { formatDateTime } from '@/lib/dateTimeConfig'
import { MISSION_QUEUED_STATUS_CODE } from '@/utils/amrMissionJobStatus'

function trimStr(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim()
}

/**
 * Mission-records rows JOIN multistop session queue fields onto each record; the session object loaded
 * later may omit them. Merge so queued callouts work before multistop fetch completes.
 */
function mergeSessionQueueMirror(
  rec: Record<string, unknown> | null | undefined,
  sess: Record<string, unknown> | null | undefined
): { queueBlockedUntil: string; queueBlockedGroupId: string; deferredCi: boolean } {
  const queueBlockedUntil = trimStr(sess?.queue_blocked_until) || trimStr(rec?.queue_blocked_until)
  const queueBlockedGroupId =
    trimStr(sess?.queue_blocked_group_id) || trimStr(rec?.queue_blocked_group_id)
  const ciS =
    typeof sess?.container_in_payload_json === 'string' && sess.container_in_payload_json.trim().length > 0
  const ciR =
    typeof rec?.container_in_payload_json === 'string' && rec.container_in_payload_json.trim().length > 0
  return { queueBlockedUntil, queueBlockedGroupId, deferredCi: ciS || ciR }
}

function queuedReasonShort(
  rec: Record<string, unknown> | null | undefined,
  mirror: ReturnType<typeof mergeSessionQueueMirror>,
  lines: string[]
): string | null {
  if (lines.length === 0) return null
  const recordQueued = rec != null && Number(rec.queued) === 1
  if (recordQueued) {
    const gid = trimStr(rec?.queued_group_id)
    const dest = trimStr(rec?.queued_destination_ref)
    if (gid) return 'Stand group: waiting for a free member'
    if (dest) return 'Destination stand: waiting until it clears'
    return 'Queued: waiting for DC to dispatch'
  }
  if (mirror.queueBlockedGroupId) {
    const recGid = trimStr(rec?.queued_group_id)
    if (mirror.queueBlockedGroupId !== recGid) return 'Next segment: resolving a stand group'
    return 'Session: stand group gate'
  }
  if (mirror.queueBlockedUntil) return 'Worker retry: scheduled next attempt'
  if (mirror.deferredCi) return 'Pickup: deferred container registration (containerIn)'
  const ls = typeof rec?.last_status === 'number' ? rec.last_status : Number(rec?.last_status ?? NaN)
  if (rec != null && Number.isFinite(ls) && ls === MISSION_QUEUED_STATUS_CODE) return 'Queued until dependencies clear'
  return 'Queued — see details below'
}

function buildAmrQueuedDependencyLines(opts: {
  record?: Record<string, unknown> | null
  session?: Record<string, unknown> | null
  groupNames?: Record<string, string>
}): string[] {
  const lines: string[] = []
  const names = opts.groupNames ?? {}
  const rec = opts.record
  const sess = opts.session
  const mirror = mergeSessionQueueMirror(rec, sess)

  const recordQueued = rec != null && Number(rec.queued) === 1

  if (recordQueued && rec) {
    const gid = trimStr(rec.queued_group_id)
    const dest = trimStr(rec.queued_destination_ref)
    if (gid) {
      lines.push(`Stand group — waiting for a free member in “${names[gid] ?? gid}”.`)
      // Concrete stand refs may be unknown until dispatch; group is the wait target.
    } else if (dest) {
      lines.push(`Destination stand — waiting until ${dest} is clear (occupancy / queue policy).`)
    } else {
      lines.push('Mission queue — waiting for DC to dispatch when policy allows.')
    }
  }

  const recGid = rec && typeof rec.queued_group_id === 'string' ? String(rec.queued_group_id).trim() : ''
  if (mirror.queueBlockedGroupId && mirror.queueBlockedGroupId !== recGid) {
    lines.push(
      `Session queue — resolving stand group “${names[mirror.queueBlockedGroupId] ?? mirror.queueBlockedGroupId}”.`
    )
  }
  if (mirror.queueBlockedUntil) {
    lines.push(`Automatic retry — next worker attempt after ${formatDateTime(mirror.queueBlockedUntil)}.`)
  }
  if (mirror.deferredCi) {
    lines.push('Pickup — deferred container registration (containerIn) until the queue releases.')
  }

  if (lines.length === 0 && rec != null) {
    const ls = typeof rec.last_status === 'number' ? rec.last_status : Number(rec.last_status)
    if (Number.isFinite(ls) && ls === MISSION_QUEUED_STATUS_CODE && Number(rec.queued) !== 1) {
      lines.push('Job status queued — worker will dispatch when dependencies clear.')
    }
  }

  return lines
}

export type AmrQueuedUiParts = {
  /** One-line operator summary of why the mission is queued / waiting */
  reasonShort: string | null
  /** Concrete dependency details (stands, groups, retry time, etc.) */
  waitingLines: string[]
}

/** Reason label plus detail lines for mission detail, overview, and tables. */
export function amrQueuedUiParts(opts: {
  record?: Record<string, unknown> | null
  session?: Record<string, unknown> | null
  groupNames?: Record<string, string>
}): AmrQueuedUiParts {
  const waitingLines = buildAmrQueuedDependencyLines(opts)
  const mirror = mergeSessionQueueMirror(opts.record, opts.session)
  return {
    reasonShort: queuedReasonShort(opts.record, mirror, waitingLines),
    waitingLines,
  }
}

/**
 * Human-readable reasons a mission/session is waiting (queued dispatch, stand/group gates, deferred containerIn).
 */
export function amrQueuedDependencyLines(opts: {
  record?: Record<string, unknown> | null
  session?: Record<string, unknown> | null
  /** `stand group id` → display name */
  groupNames?: Record<string, string>
}): string[] {
  return amrQueuedUiParts(opts).waitingLines
}
