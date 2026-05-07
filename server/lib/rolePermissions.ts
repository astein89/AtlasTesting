import type { AsyncDbWrapper } from '../db/schema.js'
import { normalizePermissionArray, roleHasPermission } from './permissionsCatalog.js'

const DEFAULT_BY_SLUG: Record<string, string[]> = {
  admin: ['*'],
  /** Floor supervisor: resolve AMR attention items without creating missions or editing stands. */
  amr_operator: ['module.amr', 'amr.attention.manage'],
  user: [
    'module.home',
    'module.testing',
    'module.wiki',
    'module.files',
    'module.amr',
    'wiki.edit',
    'testing.data.write',
    'files.manage',
    'links.edit',
    'amr.missions.manage',
    'amr.stands.manage',
    'amr.settings',
    'amr.tools.dev',
  ],
  viewer: ['module.home', 'module.testing', 'module.wiki', 'module.files', 'module.amr'],
}

/** Pick one slug for legacy `users.role` / JWT `role` (deterministic). */
export function primaryRoleSlug(slugs: string[]): string {
  if (slugs.length === 0) return 'user'
  for (const pref of ['admin', 'user', 'viewer', 'amr_operator'] as const) {
    if (slugs.includes(pref)) return pref
  }
  return [...slugs].sort()[0]
}

/** Union permissions from multiple role slugs; `*` wins. */
export async function mergePermissionsForRoleSlugs(
  db: AsyncDbWrapper,
  slugs: string[]
): Promise<string[]> {
  const cleaned = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))]
  if (cleaned.length === 0) {
    return normalizePermissionArray(DEFAULT_BY_SLUG.user)
  }
  for (const slug of cleaned) {
    const p = await getPermissionsForRoleSlug(db, slug)
    if (p.includes('*')) return ['*']
  }
  const merged = new Set<string>()
  for (const slug of cleaned) {
    for (const x of await getPermissionsForRoleSlug(db, slug)) merged.add(x)
  }
  return normalizePermissionArray([...merged])
}

export async function getPermissionsForRoleSlug(db: AsyncDbWrapper, slug: string): Promise<string[]> {
  try {
    const row = (await db.prepare('SELECT permissions FROM roles WHERE slug = ?').get(slug)) as
      | { permissions: string }
      | undefined
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
