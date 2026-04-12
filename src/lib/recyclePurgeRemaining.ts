/** Next local midnight after `from` (start of tomorrow if `from` is today afternoon). */
function nextLocalMidnight(from: Date): Date {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  return d
}

/**
 * Number of scheduled nightly purge runs until an item becomes eligible for removal,
 * matching server logic: at each run, `cutoff = purgeDayMidnight - retentionDays`, purge if `deletedAt < cutoff`.
 * @returns `0` = eligible on the next midnight purge, `1` = the purge after that, etc.
 */
export function remainingPurgesUntilAutoDelete(
  deletedAtIso: string,
  retentionDays: number,
  now: Date = new Date()
): number | null {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) return null
  const deletedAt = new Date(deletedAtIso)
  if (Number.isNaN(deletedAt.getTime())) return null

  let purgeRun = nextLocalMidnight(now)
  for (let k = 0; k < 4000; k++) {
    const cutoff = new Date(purgeRun)
    cutoff.setDate(cutoff.getDate() - retentionDays)
    if (deletedAt.getTime() < cutoff.getTime()) return k
    purgeRun.setDate(purgeRun.getDate() + 1)
  }
  return 0
}

/** Short label for recycle bin tables. */
export function formatRecycleAutoDeleteLabel(remainingPurges: number | null): string {
  if (remainingPurges === null) return '—'
  if (remainingPurges <= 0) return 'Next purge'
  if (remainingPurges === 1) return '1 day'
  return `${remainingPurges} days`
}
