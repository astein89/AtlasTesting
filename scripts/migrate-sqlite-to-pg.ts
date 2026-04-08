/**
 * One-time copy of data from dc-automation.db (SQLite) into PostgreSQL.
 * Requires DATABASE_URL or databaseUrl in config.json (same as the app); optional SQLITE_PATH or DB_PATH.
 * Does not start the HTTP server. Run: npm run db:migrate
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { resolveDatabaseUrl } from '../server/config.js'
import { BASELINE_PG_STATEMENTS } from '../server/db/schema-pg.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

function sqlitePath(): string {
  const fromEnv = process.env.SQLITE_PATH || process.env.DB_PATH
  if (fromEnv?.trim()) return path.resolve(projectRoot, fromEnv.trim())
  const a = path.join(projectRoot, 'dc-automation.db')
  const b = path.join(projectRoot, 'dc_automation.db')
  if (fs.existsSync(a)) return a
  if (fs.existsSync(b)) return b
  return a
}

const TABLE_ORDER = [
  'users',
  'roles',
  'fields',
  'test_plans',
  'tests',
  'test_runs',
  'refresh_tokens',
  'location_schemas',
  'location_schema_components',
  'location_schema_fields',
  'zones',
  'locations',
  'record_history',
  'user_preferences',
  'app_kv',
  'home_links',
  'user_roles',
] as const

/** file_folders: parents before children */
function orderedFileFolderIds(sqlite: Database.Database): string[] {
  const rows = sqlite.prepare('SELECT id, parent_id FROM file_folders').all() as Array<{
    id: string
    parent_id: string | null
  }>
  const byParent = new Map<string | null, string[]>()
  for (const r of rows) {
    const k = r.parent_id
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(r.id)
  }
  const out: string[] = []
  const walk = (pid: string | null) => {
    for (const id of byParent.get(pid) ?? []) {
      out.push(id)
      walk(id)
    }
  }
  walk(null)
  for (const r of rows) {
    if (!out.includes(r.id)) out.push(r.id)
  }
  return out
}

async function main() {
  const dbUrl = resolveDatabaseUrl()?.trim()
  if (!dbUrl) {
    console.error(
      [
        'PostgreSQL URL is required: set DATABASE_URL, or databaseUrl in config.json (see config.default.json).',
        '',
        '  PowerShell:  $env:DATABASE_URL = "postgresql://user:pass@host:5432/dbname"',
        '  cmd.exe:     set DATABASE_URL=postgresql://user:pass@host:5432/dbname',
        '  bash:        export DATABASE_URL=postgresql://...',
      ].join('\n')
    )
    process.exit(1)
  }

  const sqliteFile = sqlitePath()
  if (!fs.existsSync(sqliteFile)) {
    console.error(`SQLite file not found: ${sqliteFile}`)
    process.exit(1)
  }

  const sqlite = new Database(sqliteFile, { readonly: true })
  const pool = new pg.Pool({ connectionString: dbUrl })

  try {
    console.log('[migrate] Applying baseline PostgreSQL schema…')
    try {
      for (const sql of BASELINE_PG_STATEMENTS) {
        await pool.query(sql)
      }
    } catch (schemaErr: unknown) {
      const e = schemaErr as { code?: string }
      if (e.code === '42501') {
        console.error(
          [
            '',
            '[migrate] PostgreSQL: permission denied on schema public (SQLSTATE 42501).',
            '  The DATABASE_URL user needs CREATE on public. As a superuser, run:',
            '    GRANT ALL ON SCHEMA public TO <your_app_user>;',
            '    ALTER SCHEMA public OWNER TO <your_app_user>;',
            '  against the target database (see docs/UPGRADE_TO_POSTGRESQL.md).',
            '',
          ].join('\n')
        )
      }
      throw schemaErr
    }

    console.log('[migrate] Copying tables (SQLite → PostgreSQL)…')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const table of TABLE_ORDER) {
        const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
        if (cols.length === 0) {
          console.warn(`[migrate] skip missing table in SQLite: ${table}`)
          continue
        }
        const colNames = cols.map((c) => c.name)
        const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ')
        const insertSql = `INSERT INTO ${quoteIdent(table)} (${colNames.map(quoteIdent).join(', ')}) VALUES (${placeholders})`
        const rows = sqlite.prepare(`SELECT ${colNames.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)}`).all() as Record<
          string,
          unknown
        >[]
        let n = 0
        for (const row of rows) {
          const vals = colNames.map((c) => row[c])
          await client.query(insertSql, vals)
          n += 1
        }
        console.log(`[migrate] ${table}: ${n} rows`)
      }

      const ffOrder = orderedFileFolderIds(sqlite)
      const ffCols = sqlite.prepare(`PRAGMA table_info(file_folders)`).all() as Array<{ name: string }>
      if (ffCols.length > 0) {
        const colNames = ffCols.map((c) => c.name)
        const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ')
        const insertSql = `INSERT INTO ${quoteIdent('file_folders')} (${colNames.map(quoteIdent).join(', ')}) VALUES (${placeholders})`
        const byId = new Map(
          (sqlite.prepare(`SELECT * FROM file_folders`).all() as Record<string, unknown>[]).map((r) => [
            String(r.id),
            r,
          ])
        )
        let n = 0
        for (const id of ffOrder) {
          const row = byId.get(id)
          if (!row) continue
          const vals = colNames.map((c) => row[c])
          await client.query(insertSql, vals)
          n += 1
        }
        console.log(`[migrate] file_folders: ${n} rows`)
      }

      const sfCols = sqlite.prepare(`PRAGMA table_info(stored_files)`).all() as Array<{ name: string }>
      if (sfCols.length > 0) {
        const colNames = sfCols.map((c) => c.name)
        const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ')
        const insertSql = `INSERT INTO ${quoteIdent('stored_files')} (${colNames.map(quoteIdent).join(', ')}) VALUES (${placeholders})`
        const rows = sqlite.prepare(`SELECT * FROM stored_files`).all() as Record<string, unknown>[]
        let n = 0
        for (const row of rows) {
          const vals = colNames.map((c) => row[c])
          await client.query(insertSql, vals)
          n += 1
        }
        console.log(`[migrate] stored_files: ${n} rows`)
      }

      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    console.log('[migrate] Done.')
  } finally {
    sqlite.close()
    await pool.end()
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
