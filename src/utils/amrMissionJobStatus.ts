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
      return 'border-violet-500/35 bg-violet-500/10 text-violet-950 dark:text-violet-100'
    case 28:
      return 'border-orange-500/40 bg-orange-500/12 text-orange-950 dark:text-orange-100'
    case 10:
      return 'border-border bg-muted/80 text-foreground'
    default:
      return 'border-border bg-muted/80 text-foreground'
  }
}
