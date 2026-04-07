import { Router, type Response, type NextFunction } from 'express'
import { db } from '../db/index.js'
import { PERMISSION_CATALOG, validatePermissionsList } from '../lib/permissionsCatalog.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'
import { roleHasPermission } from '../lib/permissionsCatalog.js'

const router = Router()

const SLUG_RE = /^[a-z][a-z0-9_-]{0,48}$/

const AT_LEAST_ONE_STAR_MSG =
  'At least one role must have full access (permission *). Grant * on another role first, or keep * on this role.'

function parseRolePermissions(json: string): string[] {
  try {
    const p = JSON.parse(json) as unknown
    return Array.isArray(p) ? (p as string[]) : []
  } catch {
    return []
  }
}

/** Count roles whose permissions include `*`, optionally excluding one slug (for updates/deletes). */
function countRolesWithStarExcluding(excludeSlug?: string): number {
  const rows = db.prepare('SELECT slug, permissions FROM roles').all() as Array<{ slug: string; permissions: string }>
  let n = 0
  for (const r of rows) {
    if (excludeSlug && r.slug === excludeSlug) continue
    if (parseRolePermissions(r.permissions).includes('*')) n++
  }
  return n
}

function countUsersAssignedToRole(slug: string): number {
  const fromAssignments = db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) as c FROM user_roles WHERE role_slug = ?`
    )
    .get(slug) as { c: number }
  const legacyOnly = db
    .prepare(
      `SELECT COUNT(*) as c FROM users u
       WHERE u.role = ? AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)`
    )
    .get(slug) as { c: number }
  return (fromAssignments?.c ?? 0) + (legacyOnly?.c ?? 0)
}

router.use(authMiddleware)

/** Edit file ACL (role slugs only); same shape as `/options`. */
function requireFilesAclPicker(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(403).json({ error: 'Forbidden' })
  if (
    roleHasPermission(req.user.permissions, '*') ||
    roleHasPermission(req.user.permissions, 'files.manage')
  ) {
    return next()
  }
  return res.status(403).json({ error: 'Forbidden' })
}

router.get('/acl-picker', requireFilesAclPicker, (_req: AuthRequest, res) => {
  const rows = db.prepare('SELECT slug, label FROM roles ORDER BY slug').all() as Array<{
    slug: string
    label: string
  }>
  res.json(rows)
})

/** Role labels for user forms (anyone who can assign users). */
router.get('/options', requirePermission('users.manage'), (_req: AuthRequest, res) => {
  const rows = db.prepare('SELECT slug, label FROM roles ORDER BY slug').all() as Array<{
    slug: string
    label: string
  }>
  res.json(rows)
})

router.get(
  '/',
  requirePermission('roles.manage'),
  (_req: AuthRequest, res) => {
    const rows = db.prepare('SELECT slug, label, permissions FROM roles ORDER BY slug').all() as Array<{
      slug: string
      label: string
      permissions: string
    }>
    const roles = rows.map((r) => ({
      slug: r.slug,
      label: r.label,
      permissions: JSON.parse(r.permissions) as string[],
    }))
    res.json({ roles, catalog: PERMISSION_CATALOG })
  }
)

router.post('/', requirePermission('roles.manage'), (req: AuthRequest, res) => {
  const body = req.body as { slug?: unknown; label?: unknown; permissions?: unknown }
  const slugRaw = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  if (!slugRaw || !SLUG_RE.test(slugRaw)) {
    return res.status(400).json({
      error:
        'Invalid slug: use lowercase letters, digits, hyphen or underscore; start with a letter (max 49 chars).',
    })
  }
  const existing = db.prepare('SELECT slug FROM roles WHERE slug = ?').get(slugRaw) as { slug: string } | undefined
  if (existing) {
    return res.status(409).json({ error: 'A role with this slug already exists' })
  }
  const label =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : ''
  if (!label) {
    return res.status(400).json({ error: 'label is required' })
  }
  if (body.permissions === undefined) {
    return res.status(400).json({ error: 'permissions required' })
  }
  const err = validatePermissionsList(body.permissions)
  if (err) return res.status(400).json({ error: err })
  const perms = body.permissions as string[]
  if (perms.length === 0) {
    return res.status(400).json({ error: 'permissions array cannot be empty' })
  }
  if (!perms.includes('*') && countRolesWithStarExcluding() === 0) {
    return res.status(400).json({ error: AT_LEAST_ONE_STAR_MSG })
  }

  db.prepare('INSERT INTO roles (slug, label, permissions) VALUES (?, ?, ?)').run(
    slugRaw,
    label,
    JSON.stringify(perms)
  )
  const row = db.prepare('SELECT slug, label, permissions FROM roles WHERE slug = ?').get(slugRaw) as {
    slug: string
    label: string
    permissions: string
  }
  res.status(201).json({
    slug: row.slug,
    label: row.label,
    permissions: JSON.parse(row.permissions) as string[],
  })
})

router.put('/:slug', requirePermission('roles.manage'), (req: AuthRequest, res) => {
  const { slug } = req.params
  const body = req.body as { label?: unknown; permissions?: unknown }
  const existing = db.prepare('SELECT slug FROM roles WHERE slug = ?').get(slug) as { slug: string } | undefined
  if (!existing) {
    return res.status(404).json({ error: 'Role not found' })
  }
  if (body.label !== undefined && typeof body.label !== 'string') {
    return res.status(400).json({ error: 'label must be a string' })
  }
  if (body.permissions === undefined) {
    return res.status(400).json({ error: 'permissions required' })
  }
  const err = validatePermissionsList(body.permissions)
  if (err) return res.status(400).json({ error: err })
  const perms = body.permissions as string[]
  if (perms.length === 0) {
    return res.status(400).json({ error: 'permissions array cannot be empty' })
  }
  if (!perms.includes('*') && countRolesWithStarExcluding(slug) === 0) {
    return res.status(400).json({ error: AT_LEAST_ONE_STAR_MSG })
  }

  const label =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined
  const permissionsJson = JSON.stringify(body.permissions)

  if (label) {
    db.prepare('UPDATE roles SET label = ?, permissions = ? WHERE slug = ?').run(
      label,
      permissionsJson,
      slug
    )
  } else {
    db.prepare('UPDATE roles SET permissions = ? WHERE slug = ?').run(permissionsJson, slug)
  }

  const row = db.prepare('SELECT slug, label, permissions FROM roles WHERE slug = ?').get(slug) as {
    slug: string
    label: string
    permissions: string
  }
  res.json({
    slug: row.slug,
    label: row.label,
    permissions: JSON.parse(row.permissions) as string[],
  })
})

router.delete('/:slug', requirePermission('roles.manage'), (req: AuthRequest, res) => {
  const { slug } = req.params
  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' })
  }
  const row = db
    .prepare('SELECT slug, permissions FROM roles WHERE slug = ?')
    .get(slug) as { slug: string; permissions: string } | undefined
  if (!row) {
    return res.status(404).json({ error: 'Role not found' })
  }
  if (parseRolePermissions(row.permissions).includes('*') && countRolesWithStarExcluding(slug) === 0) {
    return res.status(400).json({ error: AT_LEAST_ONE_STAR_MSG })
  }
  const n = countUsersAssignedToRole(slug)
  if (n > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${n} user(s) still have this role. Remove it from those users first.`,
    })
  }
  db.prepare('DELETE FROM roles WHERE slug = ?').run(slug)
  res.status(204).send()
})

export { router as rolesRouter }
