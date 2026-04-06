import fs from 'node:fs'
import path from 'node:path'

/** Must match `SEGMENT_RE` in routes/wiki.ts and WIKI_PATH_SEGMENT_RE on the client. */
export const WIKI_SLUG_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * One URL segment from a human title. Sync with `slugifyWikiTitleToSegment` in src/lib/wikiPaths.ts.
 */
export function slugifyTitleToWikiSegment(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (s && WIKI_SLUG_SEGMENT_RE.test(s)) return s
  return 'page'
}

/**
 * Immediate child segment names under a parent wiki path (normalized, '' = wiki root).
 */
export function getTakenWikiChildSegments(wikiRoot: string, parentNormalized: string): Set<string> {
  const taken = new Set<string>()
  const dir =
    !parentNormalized || parentNormalized === ''
      ? path.resolve(wikiRoot)
      : path.resolve(path.join(wikiRoot, ...parentNormalized.split('/')))
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return taken
  }
  for (const e of entries) {
    if (e.name === '_deleted') continue
    if (e.isDirectory()) {
      if (WIKI_SLUG_SEGMENT_RE.test(e.name)) taken.add(e.name)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      if (e.name.toLowerCase() === 'index.md') continue
      const seg = e.name.slice(0, -3)
      if (WIKI_SLUG_SEGMENT_RE.test(seg)) taken.add(seg)
    }
  }
  return taken
}

export function suggestAvailableWikiSlugSegment(
  wikiRoot: string,
  parentNormalized: string,
  title: string
): string {
  const taken = getTakenWikiChildSegments(wikiRoot, parentNormalized)
  const base = slugifyTitleToWikiSegment(title)
  let candidate = base
  let n = 2
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`
    n += 1
    if (n > 10_000) {
      candidate = `${base}-${Date.now()}`
      break
    }
  }
  return candidate
}
