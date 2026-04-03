import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import {
  mergePermissionsForRoleSlugs,
  primaryRoleSlug,
} from '../lib/rolePermissions.js'
import { getRoleSlugsForUserId } from '../lib/userRoles.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'atlas-dev-secret-change-in-production'
const ACCESS_EXPIRY = '15m'
/** Refresh token: 24h when not "remember me", 30 days when "remember me" */
const REFRESH_EXPIRY_SESSION = '24h'
const REFRESH_EXPIRY_REMEMBER = '30d'

router.post('/login', (req, res) => {
  const { username, password, rememberMe } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' })
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username) as {
    id: string
    username: string
    password_hash: string
    name: string | null
    role: string
  } | undefined

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const roleSlugs = getRoleSlugsForUserId(db, user.id)
  const permissions = mergePermissionsForRoleSlugs(db, roleSlugs)
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
      name: user.name,
      role: rolePrimary,
      roles: roleSlugs,
      permissions,
    },
  })
})

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' })
  }

  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET) as { sub: string; type?: string }
    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(payload.sub) as
      | { id: string }
      | undefined
    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    const roleSlugs = getRoleSlugsForUserId(db, user.id)
    const permissions = mergePermissionsForRoleSlugs(db, roleSlugs)
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

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  const user = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(
    req.user!.id
  ) as { id: string; username: string; name: string | null; role: string }
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  const roleSlugs = getRoleSlugsForUserId(db, user.id)
  const permissions = mergePermissionsForRoleSlugs(db, roleSlugs)
  const rolePrimary = primaryRoleSlug(roleSlugs)
  res.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: rolePrimary,
    roles: roleSlugs,
    permissions,
  })
})

export { router as authRouter }
