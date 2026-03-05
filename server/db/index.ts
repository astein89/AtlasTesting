/// <reference path="../sqljs.d.ts" />
import initSqlJs from 'sql.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { initSchema } from './schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Dev (tsx): __dirname is server/db -> 2 levels up to project root
// Prod: __dirname is dist/server/db -> 3 levels up to project root
const levelsUp = __dirname.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
const dbPath = process.env.DB_PATH || path.join(__dirname, ...Array(levelsUp).fill('..'), 'atlas.db')

let sqlDb: import('sql.js').Database

async function init() {
  const SQL = await initSqlJs()
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath)
    sqlDb = new SQL.Database(buf)
  } else {
    sqlDb = new SQL.Database()
  }
  initSchema(sqlDb)
  save()
}

function save() {
  const data = sqlDb.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

// Wrapper to mimic better-sqlite3 API
const dbWrapper = {
  prepare(sql: string) {
    return {
      run: (...params: unknown[]) => {
        try {
          const stmt = sqlDb.prepare(sql)
          if (params.length > 0) {
            stmt.bind(params as (string | number | null)[])
          }
          stmt.step()
          stmt.free()
          save()
          return { changes: sqlDb.getRowsModified() }
        } catch (e) {
          throw e
        }
      },
      get: (...params: unknown[]) => {
        const stmt = sqlDb.prepare(sql)
        stmt.bind(params as (string | number | null)[])
        const row = stmt.step() ? stmt.getAsObject() : undefined
        stmt.free()
        return row
      },
      all: (...params: unknown[]) => {
        const stmt = sqlDb.prepare(sql)
        stmt.bind(params as (string | number | null)[])
        const rows: Record<string, unknown>[] = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      },
    }
  },
  exec(sql: string) {
    sqlDb.run(sql)
    save()
  },
}

await init()

export const db = dbWrapper
