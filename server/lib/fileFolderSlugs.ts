import { slugifyTitleToWikiSegment } from './wikiSlug.js'
import type { AsyncDbWrapper } from '../db/schema.js'
import { isUuidParam } from './testingSlugs.js'

export const FILE_FOLDER_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Reserved folder URL slugs (query `?folder=` / API references). */
export const RESERVED_FILE_FOLDER_SLUGS = new Set(['recycle', 'search', 'new'])

export function slugifyFileFolderName(name: string): string {
  return slugifyTitleToWikiSegment(name)
}

function ensureNonReservedFolderSlug(base: string): string {
  let s = base || 'folder'
  if (RESERVED_FILE_FOLDER_SLUGS.has(s)) s = `${s}-folder`
  return s
}

export function validateFileFolderSlugFormat(slug: string): string | null {
  const t = slug.trim().toLowerCase()
  if (!t) return 'Slug is required'
  if (t.length > 120) return 'Slug is too long'
  if (!FILE_FOLDER_SLUG_RE.test(t)) {
    return 'Use lowercase letters, digits, and hyphens only (e.g. my-folder)'
  }
  if (RESERVED_FILE_FOLDER_SLUGS.has(t)) return 'This slug is reserved'
  return null
}

export async function resolveFileFolderId(db: AsyncDbWrapper, param: string): Promise<string | null> {
  const p = param.trim()
  if (!p) return null
  if (isUuidParam(p)) {
    const row = (await db.prepare('SELECT id FROM file_folders WHERE id = ?').get(p)) as { id: string } | undefined
    return row?.id ?? null
  }
  const row = (await db
    .prepare('SELECT id FROM file_folders WHERE lower(slug) = lower(?)')
    .get(p)) as { id: string } | undefined
  return row?.id ?? null
}

export async function allocateUniqueFileFolderSlug(db: AsyncDbWrapper, baseRaw: string): Promise<string> {
  let base = ensureNonReservedFolderSlug(slugifyFileFolderName(baseRaw))
  if (!FILE_FOLDER_SLUG_RE.test(base)) base = 'folder'
  let candidate = base
  let n = 2
  for (;;) {
    const hit = (await db
      .prepare('SELECT id FROM file_folders WHERE lower(slug) = lower(?)')
      .get(candidate)) as { id: string } | undefined
    if (!hit) return candidate
    candidate = `${base}-${n}`
    n += 1
    if (n > 100000) {
      candidate = `${base}-${Date.now()}`
      const hit2 = (await db
        .prepare('SELECT id FROM file_folders WHERE lower(slug) = lower(?)')
        .get(candidate)) as { id: string } | undefined
      if (!hit2) return candidate
    }
  }
}

export async function isFileFolderSlugAvailable(
  db: AsyncDbWrapper,
  slug: string,
  excludeFolderId?: string
): Promise<boolean> {
  const t = slug.trim().toLowerCase()
  const err = validateFileFolderSlugFormat(t)
  if (err) return false
  if (excludeFolderId) {
    const row = (await db
      .prepare('SELECT id FROM file_folders WHERE lower(slug) = lower(?) AND id != ?')
      .get(t, excludeFolderId)) as { id: string } | undefined
    return !row
  }
  const row = (await db.prepare('SELECT id FROM file_folders WHERE lower(slug) = lower(?)').get(t)) as
    | { id: string }
    | undefined
  return !row
}

export async function ensureFileFolderSlugsBackfilled(db: AsyncDbWrapper): Promise<void> {
  const used = new Set(
    (
      (await db
        .prepare("SELECT slug FROM file_folders WHERE slug IS NOT NULL AND trim(slug) != ''")
        .all()) as Array<{ slug: string }>
    ).map((r) => r.slug.toLowerCase())
  )

  const rows = (await db
    .prepare('SELECT id, name FROM file_folders ORDER BY LOWER(name), id')
    .all()) as Array<{ id: string; name: string }>

  const upd = db.prepare('UPDATE file_folders SET slug = ? WHERE id = ?')
  for (const r of rows) {
    const cur = (await db.prepare('SELECT slug FROM file_folders WHERE id = ?').get(r.id)) as
      | { slug: string | null }
      | undefined
    if (cur?.slug && cur.slug.trim()) continue

    let base = ensureNonReservedFolderSlug(slugifyFileFolderName(r.name))
    if (!FILE_FOLDER_SLUG_RE.test(base)) base = 'folder'
    let candidate = base
    let n = 2
    while (used.has(candidate)) {
      candidate = `${base}-${n}`
      n += 1
    }
    used.add(candidate)
    await upd.run(candidate, r.id)
  }

  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_file_folders_slug ON file_folders(slug)')
}
