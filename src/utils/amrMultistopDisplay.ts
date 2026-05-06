import { filterHideStaleFleetCompleteMissions } from '@/utils/amrAppMissions'
import { missionLastStatusIsActive } from '@/utils/amrMissionJobStatus'

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
    const sid = String(r.multistop_session_id ?? '').trim()
    if (sid) sessionNeed.add(sid)
  }
  if (sessionNeed.size === 0) return recentSubset
  const seen = new Set(recentSubset.map((r) => String(r.id)))
  const extra: T[] = []
  for (const r of allRecords) {
    const sid = String(r.multistop_session_id ?? '').trim()
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
  const matching = records.filter((r) => String(r.multistop_session_id ?? '').trim() === sid)
  if (matching.length === 0) return null
  matching.sort((a, b) => stepIndex(a) - stepIndex(b))
  return matching.find((s) => stepIndex(s) === 0) ?? matching[0] ?? null
}

export function groupMissionRecords(records: Record<string, unknown>[]): GroupedMissionRow[] {
  const singles: Record<string, unknown>[] = []
  const bySession = new Map<string, Record<string, unknown>[]>()

  for (const r of records) {
    const sid = String(r.multistop_session_id ?? '').trim()
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
  return {
    ...head,
    last_status: latest.last_status,
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

export function isCompletedMultistopGroup(g: GroupedMissionMultistop): boolean {
  const st = multistopSessionStatusFromGroup(g)
  return st === 'completed' || st === 'cancelled'
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

/** Non-finalized, non-terminal fleet status — “active” for the top Active Missions table. */
export function isActiveSingleMissionRecord(r: Record<string, unknown>): boolean {
  if (Number(r.finalized) === 1) return false
  return missionLastStatusIsActive(r.last_status)
}

/**
 * Splits into in-flight vs history: multistop sessions that are not completed, plus single missions
 * that are not finalized and not terminal; all other groups go to `history` (main list with hide-stale).
 */
export function partitionMissionGroupsForTables(groups: GroupedMissionRow[]): {
  active: GroupedMissionRow[]
  history: GroupedMissionRow[]
} {
  const active: GroupedMissionRow[] = []
  const history: GroupedMissionRow[] = []
  for (const g of groups) {
    if (g.kind === 'multistop') {
      if (isCompletedMultistopGroup(g)) history.push(g)
      else active.push(g)
    } else {
      if (isActiveSingleMissionRecord(g.record)) active.push(g)
      else history.push(g)
    }
  }
  return { active, history }
}

/**
 * First fleet segment not submitted yet (`awaiting_continue`, segment index 0).
 * Uses `multistop_next_segment_index` from mission-records API when present; optional attention row as fallback.
 */
export function multistopWaitingForFirstSegmentStart(
  r: Record<string, unknown>,
  attention?: { status: string; nextSegmentIndex: number } | null
): boolean {
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
  const sid = String(detail.multistop_session_id ?? '').trim()
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
