import type { DbWrapper } from '../db/schema.js'
import { primaryRoleSlug } from './rolePermissions.js'

export function roleSlugExists(db: DbWrapper, slug: string): boolean {
  const row = db.prepare('SELECT slug FROM roles WHERE slug = ?').get(slug) as { slug: string } | undefined
  return !!row
}

export function getRoleSlugsForUserId(db: DbWrapper, userId: string): string[] {
  const rows = db
    .prepare('SELECT role_slug FROM user_roles WHERE user_id = ? ORDER BY role_slug')
    .all(userId) as Array<{ role_slug: string }>
  if (rows.length > 0) return rows.map((r) => r.role_slug)
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  return u?.role?.trim() ? [u.role.trim()] : ['user']
}

/** Replace all role assignments; keeps `users.role` in sync (primary slug). At least one role required. */
export function setUserRoles(db: DbWrapper, userId: string, slugs: string[]): void {
  const cleaned = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))]
  if (cleaned.length === 0) {
    throw new Error('At least one role is required')
  }
  for (const s of cleaned) {
    if (!roleSlugExists(db, s)) {
      throw new Error(`Unknown role: ${s}`)
    }
  }
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId)
  const ins = db.prepare('INSERT INTO user_roles (user_id, role_slug) VALUES (?, ?)')
  for (const s of cleaned) {
    ins.run(userId, s)
  }
  const primary = primaryRoleSlug(cleaned)
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(primary, userId)
}
