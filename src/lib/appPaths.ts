/**
 * URL prefixes for multi-module routing. Use these helpers instead of hardcoded paths.
 * Vite BASE_PATH is applied by React Router basename — paths here are app-relative (no base).
 */

export const TESTING_PREFIX = '/testing'
export const LOCATIONS_PREFIX = '/locations'
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
export function adminPath(...segments: string[]): string {
  if (segments.length === 0) return ADMIN_PREFIX
  const tail = segments
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '')
  return `${ADMIN_PREFIX}/${tail}`
}
