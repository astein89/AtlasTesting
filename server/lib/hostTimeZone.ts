/** IANA timezone for the Node process (matches cron scheduling / `cron-parser` when passed explicitly). */
let cached: string | null = null

export function getHostTimeZone(): string {
  if (cached) return cached
  try {
    cached = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    cached = 'UTC'
  }
  return cached
}

/**
 * Wall clock `YYYY-MM-DD HH:mm:ss.SSS` in {@link getHostTimeZone} (same zone as backup cron).
 * Fractional seconds preserve send order when multiple log rows share the same calendar second.
 * Use for AMR log `recorded_at` so entries match the Node host’s configured timezone.
 */
export function formatLogRecordedAt(d = new Date()): string {
  const tz = getHostTimeZone()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type: Intl.DateTimeFormatPart['type']) =>
    parts.find((p) => p.type === type)?.value ?? '00'
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${ms}`
}
