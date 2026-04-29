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
