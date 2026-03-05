import { Router } from 'express'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'

const router = Router()
const APP_TABLES = ['users', 'fields', 'test_plans', 'test_runs', 'refresh_tokens', 'user_preferences']

router.get('/tables', authMiddleware, requireAdmin, (_, res) => {
  res.json(APP_TABLES)
})

router.get('/tables/:name', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const { name } = req.params
  if (!APP_TABLES.includes(name)) {
    return res.status(400).json({ error: 'Invalid table name' })
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
  const offset = parseInt(req.query.offset as string) || 0

  try {
    const rows = db.prepare(`SELECT * FROM ${name} LIMIT ? OFFSET ?`).all(limit, offset)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch table data' })
  }
})

export { router as adminRouter }
