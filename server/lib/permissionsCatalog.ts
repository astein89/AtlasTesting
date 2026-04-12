/** Permission catalog for roles UI and validation. Keep groups/labels aligned with client `src/lib/permissionsCatalog.ts`. */

export const MODULE_PERMISSION_KEYS = [
  'module.home',
  'module.testing',
  'module.locations',
  'module.wiki',
  'module.files',
  'module.admin',
] as const

export type ModulePermissionKey = (typeof MODULE_PERMISSION_KEYS)[number]

/** Keys that may appear on custom home links. */
export const LINK_VISIBILITY_PERMISSION_KEYS: readonly string[] = [...MODULE_PERMISSION_KEYS]

export type PermissionCatalogEntry = {
  id: string
  label: string
  group: string
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  { id: 'module.home', label: 'Home hub', group: 'Modules' },
  { id: 'module.testing', label: 'Test Plans', group: 'Modules' },
  { id: 'module.locations', label: 'Locations', group: 'Modules' },
  { id: 'module.wiki', label: 'Wiki', group: 'Modules' },
  { id: 'module.files', label: 'Files', group: 'Modules' },
  { id: 'module.admin', label: 'Administration', group: 'Modules' },
  {
    id: 'testing.data.write',
    label: 'Create / edit / delete test records & uploads (Test Plans)',
    group: 'Module writes',
  },
  {
    id: 'locations.schemas.manage',
    label: 'Manage location schemas (components & field definitions)',
    group: 'Module writes',
  },
  {
    id: 'locations.data.write',
    label: 'Create / edit / delete zones and location rows',
    group: 'Module writes',
  },
  { id: 'home.edit', label: 'Edit home page content', group: 'Home' },
  { id: 'wiki.edit', label: 'Edit wiki pages (create / save Markdown files)', group: 'Wiki' },
  {
    id: 'wiki.recycle',
    label: 'Wiki: view recycle bin, restore, and permanently delete pages',
    group: 'Wiki',
  },
  { id: 'files.manage', label: 'Files: upload and delete library files', group: 'Files' },
  {
    id: 'files.recycle',
    label: 'Files: view recycle bin, restore, and permanently delete',
    group: 'Files',
  },
  { id: 'roles.manage', label: 'Manage roles & permissions', group: 'Administration' },
  { id: 'users.manage', label: 'Manage users', group: 'Administration' },
  { id: 'admin.db', label: 'Database tables viewer', group: 'Administration' },
  { id: 'settings.access', label: 'App settings', group: 'Administration' },
  { id: 'fields.manage', label: 'Data fields (CRUD)', group: 'Test Plans (configuration)' },
  { id: 'testing.plans.manage', label: 'Test plans (create / edit / delete)', group: 'Test Plans (configuration)' },
  { id: 'testing.tests.manage', label: 'Tests under a plan (edit / delete)', group: 'Test Plans (configuration)' },
  { id: 'records.history', label: 'View record history', group: 'Test Plans (data)' },
  { id: '*', label: 'Full access (all permissions)', group: 'Superuser' },
]

const KNOWN = new Set(PERMISSION_CATALOG.map((p) => p.id))

/** Maps legacy `data.write` to `testing.data.write`; dedupes. */
export function normalizePermissionArray(perms: string[]): string[] {
  const set = new Set(perms.filter((x): x is string => typeof x === 'string' && x.length > 0))
  if (set.has('data.write')) {
    set.delete('data.write')
    set.add('testing.data.write')
  }
  return [...set].sort()
}

export function roleHasPermission(
  permissions: string[] | undefined | null,
  key: string
): boolean {
  if (!permissions || permissions.length === 0) return false
  if (permissions.includes('*')) return true
  return permissions.includes(key)
}

export function isKnownPermissionKey(key: string): boolean {
  return KNOWN.has(key)
}

export function validatePermissionsList(keys: unknown): string | null {
  if (!Array.isArray(keys)) return 'permissions must be a JSON array'
  for (const k of keys) {
    if (typeof k !== 'string' || !isKnownPermissionKey(k)) {
      return `Unknown or invalid permission: ${String(k)}`
    }
  }
  return null
}

/** Validates keys stored on home page custom links (must be known module-style keys). */
export function isValidLinkRequiredPermission(key: string): boolean {
  return LINK_VISIBILITY_PERMISSION_KEYS.includes(key)
}
