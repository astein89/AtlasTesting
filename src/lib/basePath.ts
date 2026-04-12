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

/**
 * Root-relative path to [Adminer](https://www.adminer.org/) when installed on the host (e.g. Pi + Caddy).
 * Override with `VITE_ADMINER_URL` at build time if your reverse proxy serves it elsewhere.
 */
export function getAdminerHref(): string {
  const v = import.meta.env.VITE_ADMINER_URL
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  return '/adminer'
}

/** Prefer server-stored URL from settings; then build-time `VITE_ADMINER_URL`; then `/adminer`. */
export function resolveAdminerHref(serverUrl: string | null | undefined): string {
  if (serverUrl != null && serverUrl.trim() !== '') return serverUrl.trim()
  return getAdminerHref()
}
