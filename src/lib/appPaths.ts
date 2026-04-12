/**
 * URL prefixes for multi-module routing. Use these helpers instead of hardcoded paths.
 * Vite BASE_PATH is applied by React Router basename — paths here are app-relative (no base).
 */

import { getBasePath } from './basePath'

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

/**
 * If `pathname` still starts with the Vite/Router base (e.g. duplicate base in history), strip it so
 * `/myapp/wiki/foo` → `/wiki/foo`. React Router usually provides basename-relative paths already.
 */
export function normalizeAppPathname(pathname: string): string {
  const base = getBasePath().replace(/\/$/, '')
  if (!base) return pathname
  if (pathname === base) return '/'
  if (pathname.startsWith(`${base}/`)) {
    const rest = pathname.slice(base.length)
    return rest.startsWith('/') ? rest : `/${rest}`
  }
  return pathname
}

/**
 * Wiki trail from the `/wiki/*` route splat (matches React Router’s `params['*']`).
 * `WikiPageView` uses this first so the loaded path always matches the matched route segment.
 */
export function wikiTrailFromSplat(splat: string | undefined): string | null {
  if (splat == null || splat === '') return null
  const trail = splat.replace(/\/$/, '')
  if (!trail || trail === 'index') return 'index'
  return trail
}

/**
 * When pathname, route splat, and props disagree (basename quirks or truncated params), prefer the
 * deepest trail that fits the prefix relationships between candidates (e.g. `guides` vs `guides/test`).
 */
export function pickMostSpecificWikiTrail(trails: Array<string | null | undefined>): string {
  const normalized = trails
    .map((t) => {
      if (t == null || t === '') return null
      const x = t.replace(/^\/+|\/+$/g, '')
      return x === '' ? null : x
    })
    .filter((t): t is string => t != null)

  if (normalized.length === 0) return 'index'

  const uniq = [...new Set(normalized)]

  const maximal = uniq.filter((t) => !uniq.some((o) => o !== t && o.startsWith(`${t}/`)))

  if (maximal.length === 1) return maximal[0]!

  maximal.sort((a, b) => b.length - a.length)
  return maximal[0] ?? 'index'
}

/** Root `content/wiki/index.md` is path `index`; URLs use `/wiki` and `/wiki/edit` (not `/wiki/index`). */
export function wikiPageUrl(pagePath: string): string {
  const t = pagePath.replace(/^\/+|\/+$/g, '')
  if (!t || t === 'index') return WIKI_PREFIX
  return `${WIKI_PREFIX}/${t}`
}

/**
 * Wiki path key (`index`, `guides/foo`, …) from React Router `location.pathname`
 * (already relative to the app basename). Returns `null` if not under `/wiki`.
 * Ignores a trailing `/edit` segment so the view matches the document being edited.
 */
export function wikiTrailFromPathname(pathname: string): string | null {
  const p = normalizeAppPathname(pathname).replace(/\/+$/, '') || '/'
  if (!p.startsWith(WIKI_PREFIX)) return null
  const restRaw = p.slice(WIKI_PREFIX.length).replace(/^\/+/, '')
  if (!restRaw || restRaw === 'index') return 'index'
  let rest = restRaw
  if (rest.endsWith('/edit')) {
    rest = rest.slice(0, -5).replace(/\/+$/, '')
  }
  return rest || 'index'
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
  if (hasPermission('backup.manage')) return adminPath('backup')
  if (hasPermission('admin.db')) return adminPath('db')
  return null
}
