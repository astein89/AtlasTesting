import { Router } from 'express'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { primaryRoleSlug } from '../lib/rolePermissions.js'
import { getRoleSlugsForUserId, roleSlugExists, setUserRoles } from '../lib/userRoles.js'
import { db } from '../db/index.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'

const router = Router()
const SALT_ROUNDS = 10

function parseRoleSlugs(body: { role?: unknown; roles?: unknown }): string[] | null {
  if (Array.isArray(body.roles) && body.roles.length > 0) {
    const list = body.roles.map((x) => String(x).trim()).filter(Boolean)
    return list.length > 0 ? [...new Set(list)] : null
  }
  if (typeof body.role === 'string' && body.role.trim()) {
    return [body.role.trim()]
  }
  return null
}

router.use(authMiddleware)
router.use(requirePermission('users.manage'))

router.get('/', (_, res) => {
  const rows = db.prepare('SELECT id, username, name, role, created_at FROM users').all() as Array<{
    id: string
    username: string
    name: string | null
    role: string
    created_at: string
  }>
  res.json(
    rows.map((r) => ({
      id: r.id,
      username: r.username,
      name: r.name,
      role: r.role,
      roles: getRoleSlugsForUserId(db, r.id),
    }))
  )
})

router.get('/:id', (req, res) => {
  const row = db
    .prepare('SELECT id, username, name, role FROM users WHERE id = ?')
    .get(req.params.id) as { id: string; username: string; name: string | null; role: string } | undefined
  if (!row) return res.status(404).json({ error: 'User not found' })
  res.json({
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    roles: getRoleSlugsForUserId(db, row.id),
  })
})

router.post('/', (req, res) => {
  const { username, password, name } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' })
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)
  if (existing) return res.status(409).json({ error: 'Username already exists' })

  const slugList = parseRoleSlugs(req.body)
  if (!slugList || slugList.length === 0) {
    return res.status(400).json({ error: 'At least one role is required' })
  }
  for (const s of slugList) {
    if (!roleSlugExists(db, s)) {
      return res.status(400).json({ error: `Unknown role: ${s}` })
    }
  }

  const id = uuidv4()
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS)
  const primary = primaryRoleSlug(slugList)
  db.prepare(
    'INSERT INTO users (id, username, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
  ).run(id, username, passwordHash, name || null, primary)

  try {
    setUserRoles(db, id, slugList)
  } catch (e) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    const msg = e instanceof Error ? e.message : 'Invalid roles'
    return res.status(400).json({ error: msg })
  }

  const row = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(id) as {
    id: string
    username: string
    name: string | null
    role: string
  }
  res.status(201).json({
    ...row,
    roles: getRoleSlugsForUserId(db, id),
  })
})

router.put('/:id', (req, res) => {
  const { username, password, name, role, roles } = req.body
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
  if (roles !== undefined || role !== undefined) {
    const slugList = parseRoleSlugs({ roles, role })
    if (!slugList || slugList.length === 0) {
      return res.status(400).json({ error: 'At least one role is required' })
    }
    for (const s of slugList) {
      if (!roleSlugExists(db, s)) {
        return res.status(400).json({ error: `Unknown role: ${s}` })
      }
    }
    try {
      setUserRoles(db, id, slugList)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid roles'
      return res.status(400).json({ error: msg })
    }
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
  res.json({
    ...row,
    roles: getRoleSlugsForUserId(db, id),
  })
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
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(req.params.id)
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' })
  res.status(204).send()
})

export { router as usersRouter }
