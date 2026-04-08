import pg from 'pg'
import type { AsyncDbWrapper, AsyncPreparedStatement } from './schema.js'
import { sqlitePlaceholdersToPg } from './sqlPlaceholders.js'

export function createPgPoolWrapper(pool: pg.Pool): AsyncDbWrapper {
  return {
    prepare(sql: string): AsyncPreparedStatement {
      const text = sqlitePlaceholdersToPg(sql)
      return {
        async run(...params: unknown[]) {
          const r = await pool.query(text, params as unknown[])
          return { changes: r.rowCount ?? 0 }
        },
        async get(...params: unknown[]) {
          const r = await pool.query(text, params as unknown[])
          const row = r.rows[0] as Record<string, string | number | null> | undefined
          return row
        },
        async all(...params: unknown[]) {
          const r = await pool.query(text, params as unknown[])
          return r.rows as Record<string, unknown>[]
        },
      }
    },
    async run(sql: string, params?: unknown[] | unknown) {
      const text = sqlitePlaceholdersToPg(sql)
      const list = Array.isArray(params) ? params : params !== undefined ? [params] : []
      await pool.query(text, list as unknown[])
    },
    async exec(sql: string) {
      const trimmed = sql.trim()
      if (!trimmed) return
      await pool.query(trimmed)
    },
  }
}
