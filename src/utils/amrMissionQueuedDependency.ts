import { formatDateTime } from '@/lib/dateTimeConfig'
import { MISSION_QUEUED_STATUS_CODE } from '@/utils/amrMissionJobStatus'

/**
 * Human-readable reasons a mission/session is waiting (queued dispatch, stand/group gates, deferred containerIn).
 */
export function amrQueuedDependencyLines(opts: {
  record?: Record<string, unknown> | null
  session?: Record<string, unknown> | null
  /** `stand group id` → display name */
  groupNames?: Record<string, string>
}): string[] {
  const lines: string[] = []
  const names = opts.groupNames ?? {}
  const rec = opts.record
  const sess = opts.session

  const recordQueued = rec != null && Number(rec.queued) === 1

  if (recordQueued && rec) {
    const gid = typeof rec.queued_group_id === 'string' ? rec.queued_group_id.trim() : ''
    const dest = typeof rec.queued_destination_ref === 'string' ? rec.queued_destination_ref.trim() : ''
    if (gid) {
      lines.push(`Stand group — waiting for a free member in “${names[gid] ?? gid}”.`)
    } else if (dest) {
      lines.push(`Destination stand — waiting until ${dest} is clear (occupancy / queue policy).`)
    } else {
      lines.push('Mission queue — waiting for DC to dispatch when policy allows.')
    }
  }

  if (sess) {
    const sGid = typeof sess.queue_blocked_group_id === 'string' ? sess.queue_blocked_group_id.trim() : ''
    const recGid =
      rec && typeof rec.queued_group_id === 'string' ? String(rec.queued_group_id).trim() : ''
    if (sGid && sGid !== recGid) {
      lines.push(`Session queue — resolving stand group “${names[sGid] ?? sGid}”.`)
    }
    const until = typeof sess.queue_blocked_until === 'string' ? sess.queue_blocked_until.trim() : ''
    if (until) {
      lines.push(`Automatic retry — next worker attempt after ${formatDateTime(until)}.`)
    }
    const deferredCi =
      typeof sess.container_in_payload_json === 'string' && sess.container_in_payload_json.trim().length > 0
    if (deferredCi) {
      lines.push('Pickup — deferred container registration (containerIn) until the queue releases.')
    }
  }

  if (lines.length === 0 && rec != null) {
    const ls = typeof rec.last_status === 'number' ? rec.last_status : Number(rec.last_status)
    if (Number.isFinite(ls) && ls === MISSION_QUEUED_STATUS_CODE && Number(rec.queued) !== 1) {
      lines.push('Job status queued — worker will dispatch when dependencies clear.')
    }
  }

  return lines
}
