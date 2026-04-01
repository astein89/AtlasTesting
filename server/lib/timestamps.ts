/**
 * Normalize DB timestamps for JSON/API so clients parse them as absolute instants (UTC).
 * SQLite `datetime('now')` returns `YYYY-MM-DD HH:MM:SS` without a zone; JS may treat that
 * as local time. Values from `Date.toISOString()` already include `Z`.
 */
export function toIsoUtcString(input: string | null | undefined): string | null {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null

  if (/[zZ]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
    return null
  }

  const sqliteUtc = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(\.\d+)?)$/.exec(s)
  if (sqliteUtc) {
    const d = new Date(`${sqliteUtc[1]}T${sqliteUtc[2]}Z`)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString()
  return null
}
