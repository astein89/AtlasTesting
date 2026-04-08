import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { db } from '../db/index.js'
import {
  mergePermissionsForRoleSlugs,
  primaryRoleSlug,
} from '../lib/rolePermissions.js'
import { getRoleSlugsForUserId } from '../lib/userRoles.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { getPasswordPolicy, passwordPolicyError } from '../lib/passwordPolicy.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'atlas-dev-secret-change-in-production'
const ACCESS_EXPIRY = '15m'
/** Refresh token: 24h when not "remember me", 30 days when "remember me" */
const REFRESH_EXPIRY_SESSION = '24h'
const REFRESH_EXPIRY_REMEMBER = '30d'

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { username, password, rememberMe } = req.body
    const loginId = typeof username === 'string' ? username.trim() : ''
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Username and password required' })
    }

    const user = (await db
      .prepare(
        `SELECT * FROM users WHERE LOWER(username) = LOWER(?)
       OR (short_name IS NOT NULL AND TRIM(short_name) != '' AND LOWER(short_name) = LOWER(?))`
      )
      .get(loginId, loginId)) as
      | {
          id: string
          username: string
          short_name: string | null
          password_hash: string
          name: string | null
          role: string
          password_change_required?: number
        }
      | undefined

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const plainPw = typeof password === 'string' ? password : String(password)
    const policy = await getPasswordPolicy()
    const policyFails = passwordPolicyError(plainPw, policy) != null
    /** Admin “change on next login” must survive login; do not clear it when the password still meets policy. */
    const adminOrSessionForced = Number(user.password_change_required ?? 0) === 1
    const mustChangePassword = policyFails || adminOrSessionForced
    await db.prepare('UPDATE users SET password_change_required = ? WHERE id = ?').run(
      mustChangePassword ? 1 : 0,
      user.id
    )

    const roleSlugs = await getRoleSlugsForUserId(db, user.id)
    const permissions = await mergePermissionsForRoleSlugs(db, roleSlugs)
    const rolePrimary = primaryRoleSlug(roleSlugs)
    const accessToken = jwt.sign(
      { sub: user.id, role: rolePrimary, roles: roleSlugs, permissions },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRY }
    )
    const refreshExpiry = rememberMe ? REFRESH_EXPIRY_REMEMBER : REFRESH_EXPIRY_SESSION
    const refreshToken = jwt.sign(
      { sub: user.id, type: 'refresh' },
      JWT_SECRET,
      { expiresIn: refreshExpiry }
    )

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        shortName: user.short_name || undefined,
        name: user.name,
        role: rolePrimary,
        roles: roleSlugs,
        permissions,
        mustChangePassword,
      },
    })
  })
)

router.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    const { refreshToken } = req.body
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' })
    }

    try {
      const payload = jwt.verify(refreshToken, JWT_SECRET) as { sub: string; type?: string }
      if (payload.type !== 'refresh') {
        return res.status(401).json({ error: 'Invalid token' })
      }

      const user = (await db.prepare('SELECT id FROM users WHERE id = ?').get(payload.sub)) as
        | { id: string }
        | undefined
      if (!user) {
        return res.status(401).json({ error: 'User not found' })
      }

      const roleSlugs = await getRoleSlugsForUserId(db, user.id)
      const permissions = await mergePermissionsForRoleSlugs(db, roleSlugs)
      const rolePrimary = primaryRoleSlug(roleSlugs)
      const accessToken = jwt.sign(
        { sub: user.id, role: rolePrimary, roles: roleSlugs, permissions },
        JWT_SECRET,
        { expiresIn: ACCESS_EXPIRY }
      )
      res.json({ accessToken })
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' })
    }
  })
)

router.get(
  '/me',
  authMiddleware,
  asyncRoute(async (req: AuthRequest, res) => {
    const user = (await db
      .prepare(
        'SELECT id, username, short_name, name, role, password_change_required FROM users WHERE id = ?'
      )
      .get(req.user!.id)) as
      | {
          id: string
          username: string
          short_name: string | null
          name: string | null
          role: string
          password_change_required: number
        }
      | undefined
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    const roleSlugs = await getRoleSlugsForUserId(db, user.id)
    const permissions = await mergePermissionsForRoleSlugs(db, roleSlugs)
    const rolePrimary = primaryRoleSlug(roleSlugs)
    const mustChangePassword = Number(user.password_change_required) === 1
    res.json({
      id: user.id,
      username: user.username,
      shortName: user.short_name || undefined,
      name: user.name,
      role: rolePrimary,
      roles: roleSlugs,
      permissions,
      mustChangePassword,
    })
  })
)

router.post(
  '/change-password',
  authMiddleware,
  asyncRoute(async (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body
    if (
      currentPassword == null ||
      typeof currentPassword !== 'string' ||
      newPassword == null ||
      typeof newPassword !== 'string'
    ) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' })
    }

    const row = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id)) as
      | { password_hash: string }
      | undefined
    if (!row) {
      return res.status(404).json({ error: 'User not found' })
    }
    if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    const pwErr = passwordPolicyError(newPassword, await getPasswordPolicy())
    if (pwErr) {
      return res.status(400).json({ error: pwErr })
    }

    const hash = bcrypt.hashSync(newPassword, 10)
    await db.prepare('UPDATE users SET password_hash = ?, password_change_required = 0 WHERE id = ?').run(
      hash,
      req.user!.id
    )

    const roleSlugs = await getRoleSlugsForUserId(db, req.user!.id)
    const permissions = await mergePermissionsForRoleSlugs(db, roleSlugs)
    const rolePrimary = primaryRoleSlug(roleSlugs)
    const accessToken = jwt.sign(
      { sub: req.user!.id, role: rolePrimary, roles: roleSlugs, permissions },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRY }
    )

    const u = (await db
      .prepare('SELECT id, username, short_name, name, role FROM users WHERE id = ?')
      .get(req.user!.id)) as {
      id: string
      username: string
      short_name: string | null
      name: string | null
      role: string
    }

    res.json({
      accessToken,
      mustChangePassword: false,
      user: {
        id: u.id,
        username: u.username,
        shortName: u.short_name || undefined,
        name: u.name,
        role: rolePrimary,
        roles: roleSlugs,
        permissions,
        mustChangePassword: false,
      },
    })
  })
)

export { router as authRouter }
