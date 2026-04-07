/**
 * URL prefixes for multi-module routing. Use these helpers instead of hardcoded paths.
 * Vite BASE_PATH is applied by React Router basename — paths here are app-relative (no base).
 */

export const TESTING_PREFIX = '/testing'
export const LOCATIONS_PREFIX = '/locations'
export const WIKI_PREFIX = '/wiki'
export const FILES_PREFIX = '/files'
export const ADMIN_PREFIX = '/admin'

/** Path under the Testing module, e.g. testingPath('test-plans', planId, 'data') */
export function testingPath(...segments: string[]): string {
  if (segments.length === 0) return TESTING_PREFIX
  const tail = segments
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '')
  return `${TESTING_PREFIX}/${tail}`
}

/** Path under Locations, e.g. locationsPath('schemas', schemaId) */
export function locationsPath(...segments: string[]): string {
  if (segments.length === 0) return LOCATIONS_PREFIX
  const tail = segments
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '')
  return `${LOCATIONS_PREFIX}/${tail}`
}

/** Paths under the Admin module, e.g. adminPath('roles') -> /admin/roles */
/** Path under Wiki, e.g. wikiPath('guides', 'start') -> /wiki/guides/start */
export function wikiPath(...segments: string[]): string {
  if (segments.length === 0) return WIKI_PREFIX
  const tail = segments
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '')
  return `${WIKI_PREFIX}/${tail}`
}

/** Path under Files module (single index for v1). */
export function filesPath(...segments: string[]): string {
  if (segments.length === 0) return FILES_PREFIX
  const tail = segments
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '')
  return `${FILES_PREFIX}/${tail}`
}

/** Root `content/wiki/index.md` is path `index`; URLs use `/wiki` and `/wiki/edit` (not `/wiki/index`). */
export function wikiPageUrl(pagePath: string): string {
  const t = pagePath.replace(/^\/+|\/+$/g, '')
  if (!t || t === 'index') return WIKI_PREFIX
  return `${WIKI_PREFIX}/${t}`
}

/** Edit URL for a wiki page path. */
export function wikiEditUrl(pagePath: string): string {
  const t = pagePath.replace(/^\/+|\/+$/g, '')
  if (!t || t === 'index') return `${WIKI_PREFIX}/edit`
  return `${WIKI_PREFIX}/${t}/edit`
}

export function adminPath(...segments: string[]): string {
  if (segments.length === 0) return ADMIN_PREFIX
  const tail = segments
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '')
  return `${ADMIN_PREFIX}/${tail}`
}

/**
 * First admin sub-route the user may open (roles → users → settings → db).
 * `null` if they have no admin section permissions.
 */
export function firstAccessibleAdminPath(hasPermission: (key: string) => boolean): string | null {
  if (hasPermission('roles.manage')) return adminPath('roles')
  if (hasPermission('users.manage')) return adminPath('users')
  if (hasPermission('settings.access')) return adminPath('settings')
  if (hasPermission('admin.db')) return adminPath('db')
  return null
}
