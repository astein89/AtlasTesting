/**
 * KUKA-style fleet robot status codes (see `.cursor/plans/amr_reference_module.plan.md`).
 */
export const ROBOT_STATUS_NAMES: Record<number, string> = {
  1: 'Departure',
  2: 'Offline',
  3: 'Idle',
  4: 'Executing',
  5: 'Charging',
  6: 'Updating',
  7: 'Abnormal',
}

/** Status codes excluded from mission robot selection (not assignable). */
const EXCLUDED_FROM_MISSION_PICKER = new Set([2, 6, 7]) // Offline, Updating, Abnormal

/** Fleet robots considered available for mission assignment. */
export function isActiveRobotFleetStatus(status: unknown): boolean {
  const n = typeof status === 'number' ? status : Number(status)
  if (!Number.isFinite(n)) return true
  return !EXCLUDED_FROM_MISSION_PICKER.has(n)
}

export function robotStatusFriendly(value: unknown): { label: string; code: number | null } {
  if (value === null || value === undefined || value === '') {
    return { label: 'No status', code: null }
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return { label: String(value), code: null }
  }
  const name = ROBOT_STATUS_NAMES[n]
  if (name) return { label: name, code: n }
  return { label: 'Unknown', code: n }
}

/** Tailwind classes for the status chip (best-effort semantic hues). */
export function robotStatusChipClass(code: number | null): string {
  if (code === null) return 'border-border bg-muted/80 text-foreground/70'
  switch (code) {
    case 7:
      return 'border-red-500/45 bg-red-500/12 text-red-900 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-100'
    case 2:
      return 'border-foreground/20 bg-muted/90 text-foreground/75'
    case 5:
      return 'border-emerald-500/40 bg-emerald-500/12 text-emerald-950 dark:text-emerald-100'
    case 4:
      return 'border-sky-500/40 bg-sky-500/12 text-sky-950 dark:text-sky-100'
    case 1:
      return 'border-amber-500/40 bg-amber-500/12 text-amber-950 dark:text-amber-100'
    case 3:
      return 'border-green-500/35 bg-green-500/10 text-green-800 dark:border-green-500/30 dark:bg-green-500/12 dark:text-green-100'
    default:
      return 'border-border bg-muted/80 text-foreground'
  }
}
