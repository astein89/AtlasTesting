/** Mirrors server wiki path rules (segments: lowercase, digits, hyphens). */

export const WIKI_PATH_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * One URL segment from a human title (LeafWiki-style). Always returns a value
 * matching {@link WIKI_PATH_SEGMENT_RE} (falls back to `page` if needed).
 * Keep rules in sync with `server/lib/wikiSlug.ts`.
 */
export function slugifyWikiTitleToSegment(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (s && WIKI_PATH_SEGMENT_RE.test(s)) return s
  return 'page'
}

/**
 * Parse a single path segment from user input (slug field). Returns null if empty or invalid.
 */
export function parseWikiPathSegment(segment: string): string | null {
  const s = segment
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!s || !WIKI_PATH_SEGMENT_RE.test(s)) return null
  return s
}

/**
 * Normalizes user-typed paths before validation: lowercase, slashes trimmed,
 * spaces and underscores become hyphens (matches typical “folder” names).
 */
export function validateWikiFullPath(p: string): string | null {
  const trimmed = p.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed.length > 200) return null

  const segments = trimmed
    .toLowerCase()
    .split('/')
    .map((seg) =>
      seg
        .trim()
        .replace(/\s+/g, '-')
        .replace(/_/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)

  if (segments.length === 0 || segments.length > 10) return null
  for (const seg of segments) {
    if (!WIKI_PATH_SEGMENT_RE.test(seg)) return null
  }
  const out = segments.join('/')
  return out.length > 200 ? null : out
}

/**
 * Distinct parent paths where a new wiki page can be nested: wiki root plus every
 * prefix of each existing page path (including full paths so sections can gain children).
 */
export function wikiNestParentPathOptions(pages: { path: string }[]): string[] {
  const parents = new Set<string>([''])
  for (const { path: p } of pages) {
    const segs = p
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
    for (let i = 1; i <= segs.length; i++) {
      parents.add(segs.slice(0, i).join('/'))
    }
  }
  const arr = [...parents]
  arr.sort((a, b) => {
    if (a === '') return -1
    if (b === '') return 1
    return a.localeCompare(b)
  })
  return arr
}
