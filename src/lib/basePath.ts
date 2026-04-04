/**
 * URL path prefix when the app is served under a subpath (e.g. /dc-automation).
 * Derived from Vite `base` via `import.meta.env.BASE_URL` so it always matches the
 * built HTML and `vite.config.ts`, even if `VITE_BASE_PATH` is not present in the client env.
 * No trailing slash. Empty string at site root.
 */
export function getBasePath(): string {
  return (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
}

/**
 * Root-relative URL for a file in `/public`. Uses `BASE_URL` (trailing slash), so paths stay
 * correct for subpath deploys; use this for `<img src>` and favicons instead of `${getBasePath()}/file`.
 */
export function publicAsset(file: string): string {
  const name = file.replace(/^\/+/, '')
  return `${import.meta.env.BASE_URL ?? '/'}${name}`
}
