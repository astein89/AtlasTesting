/** Client-side countdown from an ISO deadline (server `continue_not_before`). */

export function remainingMsUntilIso(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null
  const t = Date.parse(iso.trim())
  if (!Number.isFinite(t)) return null
  return Math.max(0, t - Date.now())
}

/** Human-readable countdown; under 1 minute use seconds only (no leading `0:`). */
export function formatRemainingMmSs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return `${m}:${String(r).padStart(2, '0')}`
}
