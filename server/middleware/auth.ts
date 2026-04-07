import { type Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../db/index.js'
import {
  getPermissionsForRoleSlug,
  mergePermissionsForRoleSlugs,
} from '../lib/rolePermissions.js'
import { normalizePermissionArray, roleHasPermission } from '../lib/permissionsCatalog.js'

const JWT_SECRET = process.env.JWT_SECRET || 'atlas-dev-secret-change-in-production'

export interface JwtPayload {
  sub: string
  /** Legacy single role; kept for tokens that omit `roles`. */
  role: string
  /** When present, permissions should reflect the merge of these slugs. */
  roles?: string[]
  permissions?: string[]
  iat: number
  exp: number
}

export interface AuthRequest extends Request {
  user?: { id: string; role: string; roles: string[]; permissions: string[] }
}

/** Routes under `/api/.../auth` that must stay usable while `password_change_required` is set. */
function isPasswordChangeGateExempt(req: Request): boolean {
  const base = req.baseUrl || ''
  if (base.split('/').filter(Boolean).pop() !== 'auth') return false
  if (req.method === 'GET' && req.path === '/me') return true
  if (req.method === 'POST' && req.path === '/change-password') return true
  return false
}

/**
 * Effective permissions for this request.
 * Prefer merging from JWT `roles` / `role` against the current DB so role edits and migrations apply
 * without forcing re-login. Fall back to embedded JWT `permissions` only for legacy tokens that omit roles.
 */
function resolvePermissions(payload: JwtPayload): string[] {
  if (Array.isArray(payload.roles) && payload.roles.length > 0) {
    return mergePermissionsForRoleSlugs(db, payload.roles)
  }
  if (payload.role) {
    return mergePermissionsForRoleSlugs(db, [payload.role])
  }
  if (Array.isArray(payload.permissions) && payload.permissions.length > 0) {
    return normalizePermissionArray(payload.permissions)
  }
  return getPermissionsForRoleSlug(db, 'user')
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    const permissions = resolvePermissions(payload)
    const roles =
      Array.isArray(payload.roles) && payload.roles.length > 0
        ? payload.roles
        : payload.role
          ? [payload.role]
          : []
    req.user = { id: payload.sub, role: payload.role, roles, permissions }

    if (!isPasswordChangeGateExempt(req)) {
      const row = db
        .prepare('SELECT password_change_required FROM users WHERE id = ?')
        .get(payload.sub) as { password_change_required: number } | undefined
      if (row && Number(row.password_change_required) === 1) {
        return res.status(403).json({
          error: 'Password change required',
          code: 'PASSWORD_CHANGE_REQUIRED',
        })
      }
    }

    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export function requirePermission(key: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (!roleHasPermission(req.user.permissions, key)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

/** Full admin / wildcard (replaces legacy role string check for privileged routes). */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(403).json({ error: 'Admin required' })
  }
  if (!roleHasPermission(req.user.permissions, '*')) {
    return res.status(403).json({ error: 'Admin required' })
  }
  next()
}

/** Testing module: records & uploads (replaces legacy `data.write`). */
export function requireCanEditData(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(403).json({ error: 'Unauthorized' })
  }
  if (!roleHasPermission(req.user.permissions, 'testing.data.write')) {
    return res.status(403).json({ error: 'Viewer cannot edit or add data' })
  }
  next()
}
