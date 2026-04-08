/** Convert SQLite-style `?` placeholders to PostgreSQL `$1`, `$2`, ... */
export function sqlitePlaceholdersToPg(sql: string): string {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}
