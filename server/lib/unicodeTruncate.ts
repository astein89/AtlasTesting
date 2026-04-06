/** Truncate to at most `max` Unicode code points (never splits UTF-16 surrogate pairs). */
export function truncateMaxCodePoints(s: string, max: number): string {
  if (max <= 0) return ''
  let out = ''
  let n = 0
  for (const ch of s) {
    if (n >= max) break
    out += ch
    n++
  }
  return out
}
