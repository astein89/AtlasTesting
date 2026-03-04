import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'atlas-dev-secret-change-in-production'
const ACCESS_EXPIRY = '15m'
const REFRESH_EXPIRY = '7d'

router.post('/login', (req, res) => {
  const { username, password } = req.body
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

  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRY }
  )
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRY }
  )

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
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

    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.sub) as {
      id: string
      role: string
    } | undefined
    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    const accessToken = jwt.sign(
      { sub: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRY }
    )
    res.json({ accessToken })
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' })
  }
})

router.post('/change-password', authMiddleware, (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Current password and new password (min 6 chars) required' })
  }

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(
    req.user!.id
  ) as { password_hash: string } | undefined
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' })
  }

  const hash = bcrypt.hashSync(newPassword, 10)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user!.id)
  res.json({ ok: true })
})

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  const user = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(
    req.user!.id
  ) as { id: string; username: string; name: string | null; role: string }
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  res.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  })
})

export { router as authRouter }
