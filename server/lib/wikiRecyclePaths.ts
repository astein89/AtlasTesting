import path from 'node:path'

/** Lowercase segments: letters, digits, single hyphens inside — keep aligned with `server/routes/wiki.ts`. */
const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_DEPTH = 10
const MAX_PATH_CHARS = 200

export function validateAndNormalizeWikiPath(raw: string): string | null {
  const t = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!t) return null
  if (t.includes('..') || path.isAbsolute(t)) return null
  if (t.length > MAX_PATH_CHARS) return null
  const segments = t.split('/').filter(Boolean)
  if (segments.length === 0 || segments.length > MAX_DEPTH) return null
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) return null
  }
  return segments.join('/')
}

/**
 * Map a path relative to wiki root (e.g. `_deleted/foo/bar.md`) to the original wiki page path.
 * Handles `index.md` section pages and collision renames `name-<epochMs>.md`.
 */
export function wikiPathFromDeletedStorageRel(relFromWikiRoot: string): string | null {
  let s = relFromWikiRoot.replace(/\\/g, '/').replace(/^\/+/, '')
  if (s.startsWith('_deleted/')) s = s.slice('_deleted/'.length)
  const parts = s.split('/').filter(Boolean)
  const file = parts[parts.length - 1]
  if (!file?.toLowerCase().endsWith('.md')) return null
  const nameSans = file.slice(0, -3)
  const dirParts = parts.slice(0, -1)
  let stem = nameSans
  const ts = /^(.+)-(\d{13,})$/.exec(nameSans)
  if (ts) stem = ts[1]
  if (stem.toLowerCase() === 'index') {
    const dir = dirParts.join('/')
    if (!dir) return 'index'
    return validateAndNormalizeWikiPath(dir)
  }
  const full = [...dirParts, stem].join('/')
  return validateAndNormalizeWikiPath(full)
}
