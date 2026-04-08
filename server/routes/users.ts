import { Router } from 'express'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { primaryRoleSlug } from '../lib/rolePermissions.js'
import { getRoleSlugsForUserId, roleSlugExists, setUserRoles } from '../lib/userRoles.js'
import { db } from '../db/index.js'
import { getPasswordPolicy, passwordPolicyError } from '../lib/passwordPolicy.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()
const SALT_ROUNDS = 10

function normalizeShortName(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const s = String(raw).trim()
  return s.length > 0 ? s : null
}

/** `candidate` matches another row's username or short_name (case-insensitive). */
async function loginIdentifierTaken(candidate: string, excludeUserId?: string): Promise<boolean> {
  const c = candidate.trim()
  if (!c) return false
  if (excludeUserId) {
    const row = (await db
      .prepare(
        `SELECT id FROM users WHERE id != ? AND (
          LOWER(username) = LOWER(?) OR
          (short_name IS NOT NULL AND TRIM(short_name) != '' AND LOWER(short_name) = LOWER(?))
        )`
      )
      .get(excludeUserId, c, c)) as { id: string } | undefined
    return Boolean(row)
  }
  const row = (await db
    .prepare(
      `SELECT id FROM users WHERE
        LOWER(username) = LOWER(?) OR
        (short_name IS NOT NULL AND TRIM(short_name) != '' AND LOWER(short_name) = LOWER(?))`
    )
    .get(c, c)) as { id: string } | undefined
  return Boolean(row)
}

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

router.get(
  '/',
  asyncRoute(async (_, res) => {
    const rows = (await db
      .prepare(
        'SELECT id, username, short_name, name, role, created_at, password_change_required FROM users'
      )
      .all()) as Array<{
      id: string
      username: string
      short_name: string | null
      name: string | null
      role: string
      created_at: string
      password_change_required: number
    }>
    const out = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        username: r.username,
        shortName: r.short_name || undefined,
        name: r.name,
        role: r.role,
        roles: await getRoleSlugsForUserId(db, r.id),
        mustChangePassword: Number(r.password_change_required) === 1,
      }))
    )
    res.json(out)
  })
)

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const row = (await db
      .prepare(
        'SELECT id, username, short_name, name, role, password_change_required FROM users WHERE id = ?'
      )
      .get(req.params.id)) as
      | {
          id: string
          username: string
          short_name: string | null
          name: string | null
          role: string
          password_change_required: number
        }
      | undefined
    if (!row) return res.status(404).json({ error: 'User not found' })
    res.json({
      id: row.id,
      username: row.username,
      shortName: row.short_name || undefined,
      name: row.name,
      role: row.role,
      roles: await getRoleSlugsForUserId(db, row.id),
      mustChangePassword: Number(row.password_change_required) === 1,
    })
  })
)

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const { username, password, name, short_name: shortNameBody } = req.body
    const usernameNorm = typeof username === 'string' ? username.trim() : ''
    if (!usernameNorm || !password) {
      return res.status(400).json({ error: 'username and password required' })
    }

    const policy = await getPasswordPolicy()
    const pwErr = passwordPolicyError(String(password), policy)
    if (pwErr) {
      return res.status(400).json({ error: pwErr })
    }

    if (await loginIdentifierTaken(usernameNorm)) {
      return res.status(409).json({ error: 'That username or short name is already in use' })
    }

    const shortNorm = normalizeShortName(shortNameBody)
    if (shortNorm && (await loginIdentifierTaken(shortNorm))) {
      return res.status(409).json({ error: 'That username or short name is already in use' })
    }

    const slugList = parseRoleSlugs(req.body)
    if (!slugList || slugList.length === 0) {
      return res.status(400).json({ error: 'At least one role is required' })
    }
    for (const s of slugList) {
      if (!(await roleSlugExists(db, s))) {
        return res.status(400).json({ error: `Unknown role: ${s}` })
      }
    }

    const id = uuidv4()
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS)
    const primary = primaryRoleSlug(slugList)
    await db
      .prepare(
        'INSERT INTO users (id, username, short_name, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, usernameNorm, shortNorm, passwordHash, name || null, primary)

    try {
      await setUserRoles(db, id, slugList)
    } catch (e) {
      await db.prepare('DELETE FROM users WHERE id = ?').run(id)
      const msg = e instanceof Error ? e.message : 'Invalid roles'
      return res.status(400).json({ error: msg })
    }

    const forcePwChange = Boolean(req.body.must_change_password)
    if (forcePwChange) {
      await db.prepare('UPDATE users SET password_change_required = 1 WHERE id = ?').run(id)
    }

    const row = (await db
      .prepare(
        'SELECT id, username, short_name, name, role, password_change_required FROM users WHERE id = ?'
      )
      .get(id)) as {
      id: string
      username: string
      short_name: string | null
      name: string | null
      role: string
      password_change_required: number
    }
    res.status(201).json({
      id: row.id,
      username: row.username,
      shortName: row.short_name || undefined,
      name: row.name,
      role: row.role,
      roles: await getRoleSlugsForUserId(db, id),
      mustChangePassword: Number(row.password_change_required) === 1,
    })
  })
)

router.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const { username, password, name, short_name: shortNameBody, role, roles, must_change_password: mustChangeBody } =
      req.body
    const { id } = req.params

    const existing = await db.prepare('SELECT id FROM users WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'User not found' })

    const policy = await getPasswordPolicy()

    const updates: string[] = []
    const values: unknown[] = []
    const passwordChanging = password !== undefined && String(password).length > 0
    if (username !== undefined) {
      const u = String(username).trim()
      if (await loginIdentifierTaken(u, id)) {
        return res.status(409).json({ error: 'That username or short name is already in use' })
      }
      updates.push('username = ?')
      values.push(u)
    }
    if (shortNameBody !== undefined) {
      const sn = normalizeShortName(shortNameBody)
      if (sn && (await loginIdentifierTaken(sn, id))) {
        return res.status(409).json({ error: 'That username or short name is already in use' })
      }
      updates.push('short_name = ?')
      values.push(sn)
    }
    if (password !== undefined && password.length > 0) {
      const pwErr = passwordPolicyError(String(password), policy)
      if (pwErr) {
        return res.status(400).json({ error: pwErr })
      }
      updates.push('password_hash = ?', 'password_change_required = ?')
      values.push(bcrypt.hashSync(password, SALT_ROUNDS), 0)
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
        if (!(await roleSlugExists(db, s))) {
          return res.status(400).json({ error: `Unknown role: ${s}` })
        }
      }
      try {
        await setUserRoles(db, id, slugList)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Invalid roles'
        return res.status(400).json({ error: msg })
      }
    }
    if (!passwordChanging && mustChangeBody !== undefined && mustChangeBody !== null) {
      updates.push('password_change_required = ?')
      values.push(Boolean(mustChangeBody) ? 1 : 0)
    }
    if (updates.length > 0) {
      values.push(id)
      await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }

    const row = (await db
      .prepare(
        'SELECT id, username, short_name, name, role, password_change_required FROM users WHERE id = ?'
      )
      .get(id)) as {
      id: string
      username: string
      short_name: string | null
      name: string | null
      role: string
      password_change_required: number
    }
    res.json({
      id: row.id,
      username: row.username,
      shortName: row.short_name || undefined,
      name: row.name,
      role: row.role,
      roles: await getRoleSlugsForUserId(db, id),
      mustChangePassword: Number(row.password_change_required) === 1,
    })
  })
)

router.put(
  '/:id/password',
  asyncRoute(async (req, res) => {
    const { id } = req.params
    const { newPassword } = req.body
    if (newPassword == null || typeof newPassword !== 'string' || !newPassword.trim()) {
      return res.status(400).json({ error: 'New password required' })
    }
    const policy = await getPasswordPolicy()
    const pwErr = passwordPolicyError(newPassword, policy)
    if (pwErr) {
      return res.status(400).json({ error: pwErr })
    }

    const existing = await db.prepare('SELECT id FROM users WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'User not found' })

    const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS)
    await db.prepare('UPDATE users SET password_hash = ?, password_change_required = 0 WHERE id = ?').run(
      hash,
      id
    )
    res.json({ ok: true })
  })
)

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    await db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(req.params.id)
    const result = await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
    if (result.changes === 0) return res.status(404).json({ error: 'User not found' })
    res.status(204).send()
  })
)

export { router as usersRouter }
