/** Mirrors server `server/lib/permissionsCatalog.ts` for UI and client checks. */

export const MODULE_PERMISSION_KEYS = [
  'module.home',
  'module.testing',
  'module.locations',
  'module.wiki',
  'module.files',
  'module.admin',
] as const

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
  { id: 'links.edit', label: 'Manage home links & categories', group: 'Home' },
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
  { id: 'backup.manage', label: 'Configure backups', group: 'Administration' },
  { id: 'fields.manage', label: 'Data fields (CRUD)', group: 'Test Plans (configuration)' },
  { id: 'testing.plans.manage', label: 'Test plans (create / edit / delete)', group: 'Test Plans (configuration)' },
  { id: 'testing.tests.manage', label: 'Tests under a plan (edit / delete)', group: 'Test Plans (configuration)' },
  { id: 'records.history', label: 'View record history', group: 'Test Plans (data)' },
  { id: '*', label: 'Full access (all permissions)', group: 'Superuser' },
]

const catalogLabelById = new Map(PERMISSION_CATALOG.map((p) => [p.id, p.label]))

/** Legacy JWT/local state: map `data.write` → `testing.data.write`. */
export function normalizePermissionArray(perms: string[]): string[] {
  const set = new Set(perms.filter((x) => typeof x === 'string' && x.length > 0))
  if (set.has('data.write')) {
    set.delete('data.write')
    set.add('testing.data.write')
  }
  return [...set].sort()
}

/**
 * Role editor: each module gate lists related permissions underneath.
 * Order is preserved within each module. Labels come from PERMISSION_CATALOG.
 */
export const ROLE_EDITOR_MODULE_NESTING: Array<{
  moduleId: (typeof MODULE_PERMISSION_KEYS)[number]
  nestedIds: readonly string[]
}> = [
  { moduleId: 'module.home', nestedIds: ['home.edit', 'links.edit'] },
  {
    moduleId: 'module.testing',
    nestedIds: [
      'testing.data.write',
      'fields.manage',
      'testing.plans.manage',
      'testing.tests.manage',
      'records.history',
    ],
  },
  {
    moduleId: 'module.locations',
    nestedIds: ['locations.schemas.manage', 'locations.data.write'],
  },
  { moduleId: 'module.wiki', nestedIds: ['wiki.edit', 'wiki.recycle'] },
  { moduleId: 'module.files', nestedIds: ['files.manage', 'files.recycle'] },
  { moduleId: 'module.admin', nestedIds: ['roles.manage', 'users.manage', 'settings.access', 'admin.db'] },
]

export function getPermissionLabel(id: string): string {
  return catalogLabelById.get(id) ?? id
}

export function roleHasPermission(
  permissions: string[] | undefined | null,
  key: string
): boolean {
  if (!key) return true
  if (!permissions || permissions.length === 0) return false
  if (permissions.includes('*')) return true
  return permissions.includes(key)
}
