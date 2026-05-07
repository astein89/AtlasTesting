/**
 * Fleet job / mission status codes (see `.cursor/plans/amr_reference_module.plan.md`).
 */
export const MISSION_JOB_STATUS_NAMES: Record<number, string> = {
  10: 'Created',
  20: 'Executing',
  25: 'Waiting',
  28: 'Cancelling',
  30: 'Complete',
  31: 'Cancelled',
  35: 'Manual complete',
  50: 'Warning',
  60: 'Startup error',
  /**
   * UI-only rollup for multistop rows while `amr_multistop_sessions.status === 'awaiting_continue'`.
   * Avoids showing the previous segment’s fleet terminal code (e.g. 30) while awaiting Release / Continue.
   */
  91: 'Awaiting release',
  92: 'Queued',
  93: 'Presence warning',
  /** Synthetic — Hyperion post-drop confirmation window before pallet seen or presence warning (see {@link missionRowIsCheckingPostDropPresence}). */
  94: 'Checking presence',
}

/** Synthetic code — never returned by the fleet; see {@link MISSION_JOB_STATUS_NAMES}[91]. */
export const MULTISTOP_ROLLUP_AWAITING_RELEASE_STATUS_CODE = 91
export const MISSION_QUEUED_STATUS_CODE = 92
export const MISSION_PRESENCE_WARNING_STATUS_CODE = 93
export const MISSION_CHECKING_PRESENCE_STATUS_CODE = 94

/** Post-drop Hyperion poll: deadline set; pallet not yet confirmed and no warning (matches worker presence tick query). */
export function missionRowIsCheckingPostDropPresence(r: Record<string, unknown> | null | undefined): boolean {
  if (!r) return false
  const until = typeof r.presence_check_until === 'string' ? r.presence_check_until.trim() : ''
  if (!until) return false
  const seen = typeof r.presence_seen_at === 'string' ? r.presence_seen_at.trim() : ''
  if (seen) return false
  const warn = typeof r.presence_warning_at === 'string' ? r.presence_warning_at.trim() : ''
  if (warn) return false
  return true
}

/** Operator-visible presence warning — row may stay reserved until cleared (keep in active lists). */
export function missionRowHasPresenceWarning(r: Record<string, unknown> | null | undefined): boolean {
  if (!r) return false
  const w = typeof r.presence_warning_at === 'string' ? r.presence_warning_at.trim() : ''
  return Boolean(w)
}

/** Mission tables / detail badge: surfaces synthetic {@link MISSION_CHECKING_PRESENCE_STATUS_CODE} while polling after drop. */
export function effectiveMissionDisplayLastStatus(record: Record<string, unknown> | null | undefined): unknown {
  if (!record) return null
  if (missionRowIsCheckingPostDropPresence(record)) return MISSION_CHECKING_PRESENCE_STATUS_CODE
  return record.last_status ?? null
}

/**
 * Fleet codes after which the mission worker closes the mission row (`CLOSE_MISSION_ROW_STATUS` in `amrMissionWorker.ts`).
 * Missions whose latest `last_status` is one of these are not “active” for list purposes.
 * **50 / 60** update `last_status` but keep the row open until the fleet reports **30 / 31 / 35**.
 */
export const TERMINAL_MISSION_JOB_STATUS_CODES = new Set<number>([30, 31, 35])

/** True if the mission is still eligible for the active fleet-status list (no code yet, or not terminal). */
export function missionLastStatusIsActive(lastStatus: unknown): boolean {
  if (lastStatus == null || lastStatus === '') return true
  const n = typeof lastStatus === 'number' ? lastStatus : Number(lastStatus)
  if (!Number.isFinite(n)) return true
  return !TERMINAL_MISSION_JOB_STATUS_CODES.has(n)
}

/** Mission list / banner: queued for stand / worker — not an operator “needs attention” item. */
export function missionRowIsQuietQueueWait(flat: Record<string, unknown>): boolean {
  if (Number(flat.queued ?? 0) === 1) return true
  const ls = typeof flat.last_status === 'number' ? flat.last_status : Number(flat.last_status)
  return Number.isFinite(ls) && ls === MISSION_QUEUED_STATUS_CODE
}

/** Active / history mission tables: subtle purple row when mission is queued for dispatch. */
export const MISSION_QUEUED_ROW_TABLE_CLASS =
  'border-l-4 border-l-violet-400 bg-violet-400/[0.09] dark:border-l-violet-500 dark:bg-violet-500/[0.14]'

/** Compact queued callout panels (e.g. rack-move queued row banner). */
export const MISSION_QUEUED_CALLOUT_CLASS =
  'border-violet-400/45 bg-violet-400/[0.11] dark:border-violet-500/40 dark:bg-violet-500/[0.16]'

/** Route leg card (Mission Overview row / Mission Detail tail stop) when that segment is waiting on queue. */
export const MISSION_QUEUED_ROUTE_LEG_CARD_CLASS =
  'border-violet-400/50 bg-violet-400/[0.11] ring-1 ring-violet-400/25 dark:border-violet-500/45 dark:bg-violet-500/[0.14] dark:ring-violet-500/30'

/** Purple shell / callouts: flattened row queued, or session still has queue / deferred CI (matches list rollup cues). */
export function missionOverviewOrDetailQueuedHue(opts: {
  flat?: Record<string, unknown> | null
  session?: Record<string, unknown> | null
}): boolean {
  if (opts.flat && missionRowIsQuietQueueWait(opts.flat)) return true
  const session = opts.session
  if (session && typeof session === 'object') {
    const qb =
      typeof session.queue_blocked_until === 'string' && session.queue_blocked_until.trim().length > 0
    const qg =
      typeof session.queue_blocked_group_id === 'string' && session.queue_blocked_group_id.trim().length > 0
    const ci =
      typeof session.container_in_payload_json === 'string' &&
      session.container_in_payload_json.trim().length > 0
    return Boolean(qb || qg || ci)
  }
  return false
}

export function missionJobStatusFriendly(value: unknown): { label: string; code: number | null } {
  if (value === null || value === undefined || value === '') {
    return { label: 'No status', code: null }
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return { label: String(value), code: null }
  }
  const name = MISSION_JOB_STATUS_NAMES[n]
  if (name) return { label: name, code: n }
  return { label: 'Unknown', code: n }
}

/** Semantic chip styling for job status (terminal vs in-flight vs risk). */
export function missionJobStatusChipClass(code: number | null): string {
  if (code === null) return 'border-border bg-muted/80 text-foreground/70'
  switch (code) {
    case 30:
    case 35:
      return 'border-emerald-500/40 bg-emerald-500/12 text-emerald-950 dark:text-emerald-100'
    case 31:
      return 'border-foreground/25 bg-muted/90 text-foreground/75'
    case 60:
      return 'border-red-500/45 bg-red-500/12 text-red-900 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-100'
    case 50:
      return 'border-amber-500/45 bg-amber-500/12 text-amber-950 dark:text-amber-100'
    case 20:
      return 'border-sky-500/40 bg-sky-500/12 text-sky-950 dark:text-sky-100'
    case 25:
    case 91:
      return 'border-violet-500/35 bg-violet-500/10 text-violet-950 dark:text-violet-100'
    case 92:
      return 'border-violet-400/45 bg-violet-400/14 text-violet-950 dark:border-violet-500/40 dark:bg-violet-500/16 dark:text-violet-100'
    case 93:
      return 'border-amber-500/45 bg-amber-500/12 text-amber-950 dark:text-amber-100'
    case MISSION_CHECKING_PRESENCE_STATUS_CODE:
      return 'border-teal-500/40 bg-teal-500/12 text-teal-950 dark:text-teal-100'
    case 28:
      return 'border-orange-500/40 bg-orange-500/12 text-orange-950 dark:text-orange-100'
    case 10:
      return 'border-border bg-muted/80 text-foreground'
    default:
      return 'border-border bg-muted/80 text-foreground'
  }
}
