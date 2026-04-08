import type { AsyncDbWrapper } from '../db/schema.js'
import { primaryRoleSlug } from './rolePermissions.js'

export async function roleSlugExists(db: AsyncDbWrapper, slug: string): Promise<boolean> {
  const row = (await db.prepare('SELECT slug FROM roles WHERE slug = ?').get(slug)) as
    | { slug: string }
    | undefined
  return !!row
}

export async function getRoleSlugsForUserId(db: AsyncDbWrapper, userId: string): Promise<string[]> {
  const rows = (await db
    .prepare('SELECT role_slug FROM user_roles WHERE user_id = ? ORDER BY role_slug')
    .all(userId)) as Array<{ role_slug: string }>
  if (rows.length > 0) return rows.map((r) => r.role_slug)
  const u = (await db.prepare('SELECT role FROM users WHERE id = ?').get(userId)) as
    | { role: string }
    | undefined
  return u?.role?.trim() ? [u.role.trim()] : ['user']
}

/** Replace all role assignments; keeps `users.role` in sync (primary slug). At least one role required. */
export async function setUserRoles(db: AsyncDbWrapper, userId: string, slugs: string[]): Promise<void> {
  const cleaned = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))]
  if (cleaned.length === 0) {
    throw new Error('At least one role is required')
  }
  for (const s of cleaned) {
    if (!(await roleSlugExists(db, s))) {
      throw new Error(`Unknown role: ${s}`)
    }
  }
  await db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId)
  const ins = db.prepare('INSERT INTO user_roles (user_id, role_slug) VALUES (?, ?)')
  for (const s of cleaned) {
    await ins.run(userId, s)
  }
  const primary = primaryRoleSlug(cleaned)
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(primary, userId)
}
