import { Router } from 'express'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'

const router = Router()
const SALT_ROUNDS = 10

router.use(authMiddleware)
router.use(requireAdmin)

router.get('/', (_, res) => {
  const rows = db.prepare('SELECT id, username, name, role, created_at FROM users').all() as Array<{
    id: string
    username: string
    name: string | null
    role: string
    created_at: string
  }>
  res.json(rows.map((r) => ({ id: r.id, username: r.username, name: r.name, role: r.role })))
})

router.get('/:id', (req, res) => {
  const row = db
    .prepare('SELECT id, username, name, role FROM users WHERE id = ?')
    .get(req.params.id) as { id: string; username: string; name: string | null; role: string } | undefined
  if (!row) return res.status(404).json({ error: 'User not found' })
  res.json({ id: row.id, username: row.username, name: row.name, role: row.role })
})

router.post('/', (req, res) => {
  const { username, password, name, role } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' })
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)
  if (existing) return res.status(409).json({ error: 'Username already exists' })

  const id = uuidv4()
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS)
  db.prepare(
    'INSERT INTO users (id, username, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
  ).run(id, username, passwordHash, name || null, role || 'user')

  const row = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(id) as {
    id: string
    username: string
    name: string | null
    role: string
  }
  res.status(201).json(row)
})

router.put('/:id', (req, res) => {
  const { username, password, name, role } = req.body
  const { id } = req.params

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'User not found' })

  const updates: string[] = []
  const values: unknown[] = []
  if (username !== undefined) {
    const dup = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(username, id)
    if (dup) return res.status(409).json({ error: 'Username already exists' })
    updates.push('username = ?')
    values.push(username)
  }
  if (password !== undefined && password.length > 0) {
    updates.push('password_hash = ?')
    values.push(bcrypt.hashSync(password, SALT_ROUNDS))
  }
  if (name !== undefined) {
    updates.push('name = ?')
    values.push(name)
  }
  if (role !== undefined) {
    updates.push('role = ?')
    values.push(role)
  }
  if (updates.length > 0) {
    values.push(id)
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  }

  const row = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(id) as {
    id: string
    username: string
    name: string | null
    role: string
  }
  res.json(row)
})

router.put('/:id/password', (req, res) => {
  const { id } = req.params
  const { newPassword } = req.body
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password (min 6 chars) required' })
  }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'User not found' })

  const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' })
  res.status(204).send()
})

export { router as usersRouter }
