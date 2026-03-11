/**
 * Base path when the app is served under a path (e.g. /automation-testing).
 * Set at build time via VITE_BASE_PATH (no trailing slash).
 * Empty string when served at root.
 */
export function getBasePath(): string {
  return import.meta.env.VITE_BASE_PATH ?? ''
}
