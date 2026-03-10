import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'atlas-dev-secret-change-in-production'

export interface JwtPayload {
  sub: string
  role: string
  iat: number
  exp: number
}

export interface AuthRequest extends Request {
  user?: { id: string; role: string }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' })
  }
  next()
}

/** Blocks viewers from mutating data; admin and user can edit. */
export function requireCanEditData(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(403).json({ error: 'Unauthorized' })
  }
  if (req.user.role === 'viewer') {
    return res.status(403).json({ error: 'Viewer cannot edit or add data' })
  }
  next()
}
