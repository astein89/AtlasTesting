import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { resolveDatabaseUrl, usePostgresFromEnv } from '../config.js'
import {
  initSchema,
  type DbWrapper,
  type AsyncDbWrapper,
  type AsyncPreparedStatement,
} from './schema.js'
import { initSchemaPg } from './schema-pg.js'
import { createPgPoolWrapper } from './pg.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const levelsUp = __dirname.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
const projectRoot = path.resolve(__dirname, ...Array(levelsUp).fill('..'))
const defaultDbPath = path.join(projectRoot, 'dc-automation.db')
const dbPath = process.env.DB_PATH || defaultDbPath

function createSqliteSyncWrapper(sqlite: Database.Database): DbWrapper {
  return {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql)
      return {
        run(...params: unknown[]) {
          const r = stmt.run(...(params as []))
          return { changes: r.changes }
        },
        get(...params: unknown[]) {
          return stmt.get(...(params as [])) as Record<string, string | number | null> | undefined
        },
        all(...params: unknown[]) {
          return stmt.all(...(params as [])) as Record<string, unknown>[]
        },
      }
    },
    run(sql: string, params?: unknown[] | unknown) {
      const list = Array.isArray(params) ? params : params !== undefined ? [params] : []
      if (list.length > 0) {
        sqlite.prepare(sql).run(...(list as []))
      } else {
        sqlite.prepare(sql).run()
      }
    },
    exec(sql: string) {
      sqlite.exec(sql)
    },
  }
}

function createAsyncSqliteWrapper(sqlite: Database.Database): AsyncDbWrapper {
  const sync = createSqliteSyncWrapper(sqlite)
  return {
    prepare(sql: string): AsyncPreparedStatement {
      const stmt = sync.prepare(sql)
      return {
        async run(...params: unknown[]) {
          return stmt.run(...params)
        },
        async get(...params: unknown[]) {
          return stmt.get(...params)
        },
        async all(...params: unknown[]) {
          return stmt.all(...params)
        },
      }
    },
    async run(sql: string, params?: unknown[] | unknown) {
      sync.run(sql, params)
    },
    async exec(sql: string) {
      sync.exec(sql)
    },
  }
}

export let db: AsyncDbWrapper
export let pgPool: pg.Pool | undefined

/** Set only in SQLite mode; used for online `.backup()` in backup jobs. */
let sqliteRaw: Database.Database | null = null

/** Returns the native better-sqlite3 handle for backup-only operations, or null when using PostgreSQL. */
export function getSqliteDatabaseForBackup(): Database.Database | null {
  return sqliteRaw
}

export function isUsingPostgres(): boolean {
  return pgPool != undefined
}

export async function initDatabase(): Promise<void> {
  if (usePostgresFromEnv()) {
    const url = resolveDatabaseUrl()
    if (!url?.trim()) {
      throw new Error('[db] PostgreSQL expected: set DATABASE_URL or config.databaseUrl')
    }
    // eslint-disable-next-line no-console
    console.log('[db] Connecting to PostgreSQL…')
    pgPool = new pg.Pool({ connectionString: url })
    db = createPgPoolWrapper(pgPool)
    await initSchemaPg(db)
    // eslint-disable-next-line no-console
    console.log('[db] PostgreSQL ready (baseline schema)')
    return
  }

  const resolvedDb = path.resolve(dbPath)
  // eslint-disable-next-line no-console
  console.log(`[db] SQLite path: ${resolvedDb}`)
  // eslint-disable-next-line no-console
  console.log('[db] Opening database…')

  let sqlite: Database.Database
  try {
    sqlite = new Database(resolvedDb)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('bindings') || msg.includes('better_sqlite3.node')) {
      // eslint-disable-next-line no-console
      console.error(`
[better-sqlite3] Native addon failed to load (missing .node binary).

On Windows this often happens when:
  • Node has no prebuilt binary (e.g. Node 22+): use Node 20 LTS, then run: npm rebuild better-sqlite3
  • Install never compiled: install "Desktop development with C++" (Visual Studio Build Tools), then: npm rebuild better-sqlite3
  • Or develop with WSL2 / Linux / Raspberry Pi where build tools are normal.

See README.md (Tech Stack / troubleshooting).
`)
    }
    throw e
  }
  sqlite.pragma('busy_timeout = 10000')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  // eslint-disable-next-line no-console
  console.log('[db] Connected; applying schema/migrations…')

  sqliteRaw = sqlite
  const syncWrapper = createSqliteSyncWrapper(sqlite)
  initSchema(syncWrapper)
  db = createAsyncSqliteWrapper(sqlite)
  // eslint-disable-next-line no-console
  console.log('[db] Ready (SQLite)')
}
