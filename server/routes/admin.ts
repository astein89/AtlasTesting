import { Router } from 'express'
import { db, isUsingPostgres } from '../db/index.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()

/** All non-internal application tables (admin list). */
async function listAppTableNames(): Promise<string[]> {
  if (isUsingPostgres()) {
    const rows = (await db
      .prepare(
        `SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      )
      .all()) as Array<{ name: string }>
    return rows.map((r) => r.name)
  }
  const rows = (await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

async function isAppTable(name: string): Promise<boolean> {
  if (isUsingPostgres()) {
    const row = (await db
      .prepare(
        `SELECT 1 AS ok FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = ?`
      )
      .get(name)) as { ok: number } | undefined
    return row != null
  }
  const row = (await db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name = ?`
    )
    .get(name)) as { ok: number } | undefined
  return row != null
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

router.get(
  '/tables',
  authMiddleware,
  requirePermission('admin.db'),
  asyncRoute(async (_, res) => {
    try {
      res.json(await listAppTableNames())
    } catch {
      res.status(500).json({ error: 'Failed to list tables' })
    }
  })
)

router.get(
  '/tables/:name',
  authMiddleware,
  requirePermission('admin.db'),
  asyncRoute(async (req: AuthRequest, res) => {
    const { name } = req.params
    if (!(await isAppTable(name))) {
      return res.status(400).json({ error: 'Invalid or unknown table name' })
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const offset = parseInt(req.query.offset as string) || 0

    try {
      const q = `SELECT * FROM ${quoteIdent(name)} LIMIT ? OFFSET ?`
      const rows = await db.prepare(q).all(limit, offset)
      res.json(rows)
    } catch {
      res.status(500).json({ error: 'Failed to fetch table data' })
    }
  })
)

export { router as adminRouter }
