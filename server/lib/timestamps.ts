/**
 * SQL RHS for TEXT `updated_at` / `created_at` style columns: UTC wall clock `YYYY-MM-DD HH:MM:SS`,
 * aligned with SQLite `datetime('now')` and PostgreSQL defaults in `schema-pg.ts`.
 * Use as: `` `... SET updated_at = ${sqlUtcNowExpr(isPostgres)} ...` ``
 */
export function sqlUtcNowExpr(isPostgres: boolean): string {
  return isPostgres
    ? `to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS')`
    : `datetime('now')`
}

/**
 * Unix epoch (seconds) from subquery alias `x`, timestamp text column `ts`, for MAX(...) / aggregates.
 * Matches SQLite strftime('%s', x.ts) for naive UTC-style TEXT timestamps.
 */
export function sqlUnixEpochFromXTs(isPostgres: boolean): string {
  return isPostgres
    ? `FLOOR(EXTRACT(EPOCH FROM (x.ts::timestamp AT TIME ZONE 'UTC')))`
    : `CAST(strftime('%s', x.ts) AS INTEGER)`
}

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
