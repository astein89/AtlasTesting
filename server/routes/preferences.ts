import { Router } from 'express'
import { db } from '../db/index.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

router.get('/', (req: AuthRequest, res) => {
  const userId = req.user!.id
  const rows = db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ?').all(userId) as {
    key: string
    value: string
  }[]
  const prefs: Record<string, string> = {}
  for (const r of rows) prefs[r.key] = r.value
  res.json(prefs)
})

router.put('/', (req: AuthRequest, res) => {
  const userId = req.user!.id
  const { key, value } = req.body
  if (typeof key !== 'string' || key.trim() === '') {
    return res.status(400).json({ error: 'key required' })
  }
  const val = typeof value === 'string' ? value : JSON.stringify(value)
  db.prepare(
    'INSERT OR REPLACE INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)'
  ).run(userId, key.trim(), val)
  res.json({ ok: true })
})

export { router as preferencesRouter }
