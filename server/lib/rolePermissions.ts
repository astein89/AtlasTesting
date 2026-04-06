import type { DbWrapper } from '../db/schema.js'
import { normalizePermissionArray, roleHasPermission } from './permissionsCatalog.js'

const DEFAULT_BY_SLUG: Record<string, string[]> = {
  admin: ['*'],
  user: ['module.home', 'module.testing', 'module.wiki', 'wiki.edit', 'testing.data.write'],
  viewer: ['module.home', 'module.testing', 'module.wiki'],
}

/** Pick one slug for legacy `users.role` / JWT `role` (deterministic). */
export function primaryRoleSlug(slugs: string[]): string {
  if (slugs.length === 0) return 'user'
  for (const pref of ['admin', 'user', 'viewer'] as const) {
    if (slugs.includes(pref)) return pref
  }
  return [...slugs].sort()[0]
}

/** Union permissions from multiple role slugs; `*` wins. */
export function mergePermissionsForRoleSlugs(db: DbWrapper, slugs: string[]): string[] {
  const cleaned = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))]
  if (cleaned.length === 0) {
    return normalizePermissionArray(DEFAULT_BY_SLUG.user)
  }
  for (const slug of cleaned) {
    const p = getPermissionsForRoleSlug(db, slug)
    if (p.includes('*')) return ['*']
  }
  const merged = new Set<string>()
  for (const slug of cleaned) {
    for (const x of getPermissionsForRoleSlug(db, slug)) merged.add(x)
  }
  return normalizePermissionArray([...merged])
}

export function getPermissionsForRoleSlug(db: DbWrapper, slug: string): string[] {
  try {
    const row = db
      .prepare('SELECT permissions FROM roles WHERE slug = ?')
      .get(slug) as { permissions: string } | undefined
    if (!row?.permissions) {
      return normalizePermissionArray(DEFAULT_BY_SLUG[slug] ?? DEFAULT_BY_SLUG.user)
    }
    const parsed = JSON.parse(row.permissions) as unknown
    if (!Array.isArray(parsed)) {
      return normalizePermissionArray(DEFAULT_BY_SLUG[slug] ?? DEFAULT_BY_SLUG.user)
    }
    const filtered = parsed.filter((x): x is string => typeof x === 'string')
    return normalizePermissionArray(filtered)
  } catch {
    return normalizePermissionArray(DEFAULT_BY_SLUG[slug] ?? DEFAULT_BY_SLUG.user)
  }
}

export { roleHasPermission }
