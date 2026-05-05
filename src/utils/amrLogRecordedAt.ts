/**
 * Normalize AMR log `recorded_at` strings for lexicographic sort (newest-first when used with `localeCompare` reversed).
 * Legacy rows without `.sss` are treated as `.000` so order stays stable vs millisecond-precision timestamps.
 */
export function normalizeRecordedAtSortKey(s: string): string {
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(t)) return t
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return `${t}.000`
  return t
}

export function compareRecordedAtStrings(a: unknown, b: unknown): number {
  return normalizeRecordedAtSortKey(String(a ?? '')).localeCompare(
    normalizeRecordedAtSortKey(String(b ?? ''))
  )
}
