/**
 * Fleet container `inMapStatus` — API uses 0 / 1 (see AMR APIs containerQuery examples).
 */
/** Fleet `emptyFullStatus` — typically 0 = empty, 1 = full (see AMR API samples). */
export function containerEmptyFullFriendly(value: unknown): { label: string; code: number | null } {
  if (value === null || value === undefined || value === '') {
    return { label: 'Unknown', code: null }
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return { label: String(value), code: null }
  }
  if (n === 0) return { label: 'Empty', code: 0 }
  if (n === 1) return { label: 'Full', code: 1 }
  return { label: 'Unknown', code: n }
}

export function containerInMapFriendly(value: unknown): { label: string; code: number | null } {
  if (value === null || value === undefined || value === '') {
    return { label: 'Unknown', code: null }
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return { label: String(value), code: null }
  }
  if (n === 1) return { label: 'In map', code: 1 }
  if (n === 0) return { label: 'Not in map', code: 0 }
  return { label: 'Unknown', code: n }
}

export function containerInMapChipClass(code: number | null): string {
  if (code === 1) {
    return 'border-emerald-500/40 bg-emerald-500/12 text-emerald-950 dark:text-emerald-100'
  }
  if (code === 0) {
    return 'border-foreground/20 bg-muted/90 text-foreground/75'
  }
  return 'border-border bg-muted/80 text-foreground/70'
}
