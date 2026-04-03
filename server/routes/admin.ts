import { Router } from 'express'
import { db } from '../db/index.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'

const router = Router()

/** All non-internal SQLite tables (keeps admin list in sync with migrations). */
function listAppTableNames(): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function isAppTable(name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name = ?`
    )
    .get(name) as { ok: number } | undefined
  return row != null
}

function quoteSQLiteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

router.get('/tables', authMiddleware, requirePermission('admin.db'), (_, res) => {
  try {
    res.json(listAppTableNames())
  } catch {
    res.status(500).json({ error: 'Failed to list tables' })
  }
})

router.get('/tables/:name', authMiddleware, requirePermission('admin.db'), (req: AuthRequest, res) => {
  const { name } = req.params
  if (!isAppTable(name)) {
    return res.status(400).json({ error: 'Invalid or unknown table name' })
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
  const offset = parseInt(req.query.offset as string) || 0

  try {
    const q = `SELECT * FROM ${quoteSQLiteIdent(name)} LIMIT ? OFFSET ?`
    const rows = db.prepare(q).all(limit, offset)
    res.json(rows)
  } catch {
    res.status(500).json({ error: 'Failed to fetch table data' })
  }
})

export { router as adminRouter }
