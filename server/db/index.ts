import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { initSchema, type DbWrapper } from './schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const levelsUp = __dirname.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
const dbPath = process.env.DB_PATH || path.join(__dirname, ...Array(levelsUp).fill('..'), 'atlas.db')

function createDbWrapper(sqlite: Database.Database): DbWrapper {
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

const resolvedDb = path.resolve(dbPath)
// eslint-disable-next-line no-console
console.log(`[db] atlas.db path: ${resolvedDb}`)

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
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('synchronous = NORMAL')

const dbWrapper = createDbWrapper(sqlite)
initSchema(dbWrapper)

export const db = dbWrapper