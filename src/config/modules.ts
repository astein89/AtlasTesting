import { ADMIN_PREFIX, TESTING_PREFIX, LOCATIONS_PREFIX } from '@/lib/appPaths'

export interface AppModule {
  id: string
  /** First URL segment, e.g. "testing" -> /testing */
  path: string
  title: string
  description: string
  /**
   * Permission required to show this card and use the module routes.
   * Defaults to `module.${id}` when omitted.
   */
  requiredPermission?: string
  /** Full path to navigate when opening the module */
  to: string
}

export function getModuleRequiredPermission(m: AppModule): string {
  return m.requiredPermission ?? `module.${m.id}`
}

export const appModules: AppModule[] = [
  {
    id: 'testing',
    path: 'testing',
    title: 'Testing',
    description: 'Test plans, data entry, results, and data fields.',
    to: TESTING_PREFIX,
  },
  {
    id: 'locations',
    path: 'locations',
    title: 'Locations',
    description: 'Location schemas, zones, and location management.',
    requiredPermission: 'module.locations',
    to: LOCATIONS_PREFIX,
  },
  {
    id: 'admin',
    path: 'admin',
    title: 'Administration',
    description: 'Roles, users, database tools, and system access.',
    requiredPermission: 'module.admin',
    to: ADMIN_PREFIX,
  },
]
