import { filterHideStaleFleetCompleteMissions } from '@/utils/amrAppMissions'
import { MISSION_QUEUED_STATUS_CODE, MULTISTOP_ROLLUP_AWAITING_RELEASE_STATUS_CODE } from '@/utils/amrMissionJobStatus'

export type GroupedMissionSingle = {
  kind: 'single'
  record: Record<string, unknown>
}

export type GroupedMissionMultistop = {
  kind: 'multistop'
  sessionId: string
  head: Record<string, unknown>
  segments: Record<string, unknown>[]
  latest: Record<string, unknown>
  segmentCount: number
}

export type GroupedMissionRow = GroupedMissionSingle | GroupedMissionMultistop

function stepIndex(r: Record<string, unknown>): number {
  const raw = r.multistop_step_index
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** Stable session key for grouping / joins (API may use snake_case or camelCase). */
export function multistopSessionIdFromRow(r: Record<string, unknown>): string {
  const raw = r.multistop_session_id ?? (r as { multistopSessionId?: unknown }).multistopSessionId
  if (typeof raw === 'string') return raw.trim()
  if (raw != null && typeof raw !== 'object') return String(raw).trim()
  return ''
}

/**
 * After age-filtering mission rows, pull in every segment for any multistop session that still has
 * at least one segment in the window (so grouping does not drop middle legs).
 */
export function expandMultistopSessionsForRecentWindow<T extends Record<string, unknown>>(
  allRecords: T[],
  recentSubset: T[]
): T[] {
  const sessionNeed = new Set<string>()
  for (const r of recentSubset) {
    const sid = multistopSessionIdFromRow(r)
    if (sid) sessionNeed.add(sid)
  }
  if (sessionNeed.size === 0) return recentSubset
  const seen = new Set(recentSubset.map((r) => String(r.id)))
  const extra: T[] = []
  for (const r of allRecords) {
    const sid = multistopSessionIdFromRow(r)
    if (!sid || !sessionNeed.has(sid)) continue
    const id = String(r.id)
    if (seen.has(id)) continue
    seen.add(id)
    extra.push(r)
  }
  return [...recentSubset, ...extra]
}

/** Head segment (step 0) for a multistop session, or null if none match full `records` (e.g. API list). */
export function headMissionRecordForSession(
  records: Record<string, unknown>[],
  sessionId: string
): Record<string, unknown> | null {
  const sid = sessionId.trim()
  if (!sid) return null
  const matching = records.filter((r) => multistopSessionIdFromRow(r) === sid)
  if (matching.length === 0) return null
  matching.sort((a, b) => stepIndex(a) - stepIndex(b))
  return matching.find((s) => stepIndex(s) === 0) ?? matching[0] ?? null
}

export function groupMissionRecords(records: Record<string, unknown>[]): GroupedMissionRow[] {
  const singles: Record<string, unknown>[] = []
  const bySession = new Map<string, Record<string, unknown>[]>()

  for (const r of records) {
    const sid = multistopSessionIdFromRow(r)
    if (!sid) {
      singles.push(r)
      continue
    }
    let arr = bySession.get(sid)
    if (!arr) {
      arr = []
      bySession.set(sid, arr)
    }
    arr.push(r)
  }

  const groups: GroupedMissionRow[] = []
  for (const r of singles) {
    groups.push({ kind: 'single', record: r })
  }

  for (const [sessionId, segments] of bySession) {
    segments.sort((a, b) => stepIndex(a) - stepIndex(b))
    const head = segments.find((s) => stepIndex(s) === 0) ?? segments[0]
    let latest = segments[0]
    for (const s of segments) {
      if (stepIndex(s) > stepIndex(latest)) latest = s
    }
    groups.push({
      kind: 'multistop',
      sessionId,
      head,
      segments,
      latest,
      segmentCount: segments.length,
    })
  }

  return groups
}

function trimStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t || undefined
}

/**
 * Robot executing or holding the mission: active segment’s `locked_robot_id`, else session
 * `session_locked_robot_id` (e.g. between legs on `awaiting_continue`).
 */
function mergedMissionRobotId(head: Record<string, unknown>, latest: Record<string, unknown>): string | undefined {
  return trimStr(latest.locked_robot_id) ?? trimStr(head.locked_robot_id) ?? trimStr(head.session_locked_robot_id)
}

/** One synthetic mission row for sorting, filtering, and table cells (rollup from latest segment). */
export function flattenGroupedMissionRow(group: GroupedMissionRow): Record<string, unknown> {
  if (group.kind === 'single') return { ...group.record }
  const { head, latest, sessionId, segmentCount } = group
  const robotId = mergedMissionRobotId(head, latest)
  const sessionWorkflow = multistopSessionStatusFromGroup(group)
  const queueBlockedUntil = typeof head.queue_blocked_until === 'string' ? head.queue_blocked_until.trim() : ''
  const queueBlockedGroupId =
    typeof head.queue_blocked_group_id === 'string' ? head.queue_blocked_group_id.trim() : ''
  const hasDeferredContainerIn = typeof head.container_in_payload_json === 'string' && head.container_in_payload_json.trim().length > 0
  /** Previous leg may already be fleet‑complete while the session is still waiting on Release — don’t surface that as row status. */
  const rollupLastStatus =
    sessionWorkflow === 'awaiting_continue'
      ? queueBlockedUntil || hasDeferredContainerIn || queueBlockedGroupId
        ? MISSION_QUEUED_STATUS_CODE
        : MULTISTOP_ROLLUP_AWAITING_RELEASE_STATUS_CODE
      : latest.last_status
  return {
    ...head,
    last_status: rollupLastStatus,
    worker_closed: latest.worker_closed,
    finalized: latest.finalized,
    updated_at: latest.updated_at,
    multistop_session_id: sessionId,
    multistop_segment_count: segmentCount,
    multistop_session_status: head.multistop_session_status ?? latest.multistop_session_status,
    locked_robot_id: robotId ?? null,
  }
}

/** Session row status from `amr_multistop_sessions` (via mission-records JOIN). */
export function multistopSessionStatusFromGroup(g: GroupedMissionMultistop): string | null {
  const raw = g.head.multistop_session_status ?? g.latest.multistop_session_status
  if (raw == null) return null
  const s = String(raw).trim()
  return s || null
}

/** Pickup + one node per segment: `1 + segmentCount` physical stops on the route. */
export function physicalStopCountFromMultistopGroup(g: GroupedMissionMultistop): number {
  return 1 + Math.max(0, g.segmentCount)
}

/**
 * UI “Multi-stop” (vs a simple pickup→drop): more than two physical stops (pickup plus two or more destinations),
 * i.e. more than one fleet segment.
 */
export function isChainedMultistopGroup(g: GroupedMissionMultistop): boolean {
  return g.segmentCount > 1
}

/** Missions / dashboard row badge: label Multi-stop only for chained routes. */
export function multistopRouteKindBadgeLabel(g: GroupedMissionMultistop): string {
  const n = physicalStopCountFromMultistopGroup(g)
  const w = n === 1 ? 'stop' : 'stops'
  if (isChainedMultistopGroup(g)) return `Multi-stop · ${n} ${w}`
  return `Route · ${n} ${w}`
}

/**
 * Fleet job statuses that close out the job for Mission History (matches worker `CLOSE_MISSION_ROW_STATUS`):
 * **30** complete, **31** cancelled, **35** manual complete. All other reported statuses — including **50** Warning and
 * **60** error — stay in **Active Missions** so operators can follow recovery and non-terminal states.
 */
const FLEET_JOB_STATUS_MISSION_HISTORY = new Set([30, 31, 35])

/**
 * `true` when the rolled-up fleet `last_status` should list the mission under Mission History.
 * Unknown / null / non-finite → Active (same as in-progress).
 */
export function fleetJobStatusBelongsInMissionHistory(lastStatus: unknown): boolean {
  const n = typeof lastStatus === 'number' && Number.isFinite(lastStatus) ? lastStatus : Number(lastStatus)
  return Number.isFinite(n) && FLEET_JOB_STATUS_MISSION_HISTORY.has(n)
}

function multistopSessionWorkflowKeepsMissionActive(workflow: string | null): boolean {
  if (workflow == null || !String(workflow).trim()) return false
  switch (String(workflow).trim().toLowerCase()) {
    case 'active':
    case 'awaiting_continue':
    case 'pending':
    case 'failed':
      return true
    default:
      return false
  }
}

/**
 * Splits **Active Missions** vs **Mission History** using the **latest fleet job status** on the row
 * (`flattenGroupedMissionRow`), not session workflow alone — so Warning (**50**) never lands in history just because
 * the multistop session row was marked completed while the fleet still reports 50.
 *
 * Multistop: while `amr_multistop_sessions.status` is still **active / awaiting_continue / pending / failed**, keep the
 * group in **Active** even if the **latest segment row** shows fleet-complete (**30**) — that often means the last
 * *submitted* leg finished, not that the whole route is done.
 */
export function partitionMissionGroupsForTables(groups: GroupedMissionRow[]): {
  active: GroupedMissionRow[]
  history: GroupedMissionRow[]
} {
  const active: GroupedMissionRow[] = []
  const history: GroupedMissionRow[] = []
  for (const g of groups) {
    if (g.kind === 'multistop') {
      const ws = multistopSessionStatusFromGroup(g)
      if (multistopSessionWorkflowKeepsMissionActive(ws)) {
        active.push(g)
        continue
      }
    }
    const flat = flattenGroupedMissionRow(g)
    if (fleetJobStatusBelongsInMissionHistory(flat.last_status)) history.push(g)
    else active.push(g)
  }
  return { active, history }
}

/**
 * First fleet segment not submitted yet (`awaiting_continue`, segment index 0).
 * Uses `multistop_next_segment_index` from mission-records API when present; optional attention row as fallback.
 * When the row is **queued** ({@link flattenGroupedMissionRow} → {@link MISSION_QUEUED_STATUS_CODE}, or DB `queued`), we keep
 * the status chip (“Queued”), not “Waiting for start”.
 */
export function multistopWaitingForFirstSegmentStart(
  r: Record<string, unknown>,
  attention?: { status: string; nextSegmentIndex: number } | null
): boolean {
  if (Number(r.queued ?? 0) === 1) return false
  const ls = typeof r.last_status === 'number' ? r.last_status : Number(r.last_status)
  if (Number.isFinite(ls) && ls === MISSION_QUEUED_STATUS_CODE) return false
  const st = String(r.multistop_session_status ?? '').trim()
  const rawIdx = r.multistop_next_segment_index
  if (st === 'awaiting_continue' && rawIdx !== undefined && rawIdx !== null) {
    const idx = typeof rawIdx === 'number' && Number.isFinite(rawIdx) ? rawIdx : Number(rawIdx)
    if (Number.isFinite(idx)) return idx === 0
  }
  if (
    attention &&
    attention.status === 'awaiting_continue' &&
    attention.nextSegmentIndex === 0
  )
    return true
  return false
}

export function friendlyMultistopSessionStatus(status: string): string {
  const m: Record<string, string> = {
    awaiting_continue: 'Waiting for next step',
    failed: 'Failed',
    active: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    pending: 'Pending',
  }
  return m[status] ?? status.replace(/_/g, ' ')
}

/** Maps session workflow to a fleet-like status code for mission table chip colors when fleet status is absent. */
export function multistopSessionWorkflowChipCode(workflow: string | null): number | null {
  if (workflow == null || !String(workflow).trim()) return null
  switch (String(workflow).trim()) {
    case 'active':
      return 20
    case 'awaiting_continue':
      return 25
    case 'failed':
      return 60
    case 'completed':
      return 30
    case 'cancelled':
      return 35
    case 'pending':
      return 10
    default:
      return null
  }
}

/** Record passed into mission detail modal — matches list rollup (latest segment status for multi-stop). */
export function headRecordForMissionDetail(group: GroupedMissionRow): Record<string, unknown> {
  return group.kind === 'single' ? group.record : flattenGroupedMissionRow(group)
}

/**
 * After mission rows refresh while the detail modal is open, find the same mission so status tracks the latest leg.
 */
export function resolvedMissionDetailRecord(
  detail: Record<string, unknown>,
  groups: GroupedMissionRow[]
): Record<string, unknown> | null {
  const id = String(detail.id ?? '')
  const sid = multistopSessionIdFromRow(detail)
  for (const g of groups) {
    if (g.kind === 'multistop') {
      if ((sid && g.sessionId === sid) || String(g.head.id) === id) {
        return flattenGroupedMissionRow(g)
      }
    } else if (String(g.record.id) === id) {
      return g.record
    }
  }
  return null
}

export function findMultistopGroupBySessionId(
  groups: GroupedMissionRow[],
  sessionId: string
): GroupedMissionMultistop | null {
  const sid = sessionId.trim()
  if (!sid) return null
  for (const g of groups) {
    if (g.kind === 'multistop' && g.sessionId === sid) return g
  }
  return null
}

export function filterGroupedMissionsHideStale(
  groups: GroupedMissionRow[],
  hideAfterMinutes: number | null
): GroupedMissionRow[] {
  if (hideAfterMinutes == null || !Number.isFinite(hideAfterMinutes) || hideAfterMinutes <= 0) return groups
  const synthetic = groups.map((g) => flattenGroupedMissionRow(g))
  const kept = new Set(filterHideStaleFleetCompleteMissions(synthetic, hideAfterMinutes).map((r) => String(r.id)))
  return groups.filter((g) => kept.has(String(headRecordForMissionDetail(g).id)))
}
