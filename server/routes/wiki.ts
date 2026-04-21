import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router, type Response } from 'express'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import {
  authMiddleware,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.js'
import { truncateMaxCodePoints } from '../lib/unicodeTruncate.js'
import { suggestAvailableWikiSlugSegment } from '../lib/wikiSlug.js'
import { roleHasPermission } from '../lib/permissionsCatalog.js'
import { db } from '../db/index.js'
import { roleSlugExists } from '../lib/userRoles.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import {
  readWikiRecycleManifest,
  removeWikiRecycleManifestEntry,
  upsertWikiRecycleManifestEntry,
} from '../lib/wikiRecycleManifest.js'
import { wikiPathFromDeletedStorageRel } from '../lib/wikiRecyclePaths.js'
import { listDeletedWikiMarkdownFiles } from '../lib/wikiRecyclePurge.js'
import { getWikiRecycleRetentionDays } from '../lib/wikiRecycleSettings.js'

const router = Router()

const MAX_DEPTH = 10
const MAX_PATH_CHARS = 200
const MAX_MARKDOWN_CHARS = 500_000
/** Lowercase segments: letters, digits, single hyphens inside. */
const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SIDEBAR_ORDER_FILENAME = '.wiki-order.json'
const PAGE_META_FILENAME = '.wiki-page-meta.json'
const MAX_VIEW_ROLE_SLUGS = 32

/** Visibility filter: users with any of these roles may view the page (when not empty). */
type PageMetaEntry = {
  viewRoleSlugs?: string[]
  showSectionPages?: boolean
  /** Display name in sidebar/nav; independent of markdown body. */
  title?: string
}
type PageMetaFile = Record<string, PageMetaEntry>

function prunePageMetaEntry(entry: PageMetaEntry): PageMetaEntry | null {
  const out: PageMetaEntry = {}
  if (entry.viewRoleSlugs && entry.viewRoleSlugs.length > 0) {
    out.viewRoleSlugs = entry.viewRoleSlugs.slice(0, MAX_VIEW_ROLE_SLUGS)
  }
  if (entry.showSectionPages === false) {
    out.showSectionPages = false
  }
  if (entry.title && entry.title.trim()) {
    out.title = truncateMaxCodePoints(entry.title.trim(), 200)
  }
  return Object.keys(out).length > 0 ? out : null
}

function pageMetaFilePath(wikiRoot: string): string {
  return path.join(wikiRoot, PAGE_META_FILENAME)
}

function readPageMeta(wikiRoot: string): PageMetaFile {
  const fp = pageMetaFilePath(wikiRoot)
  try {
    const raw = fs.readFileSync(fp, 'utf8')
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return {}
    const out: PageMetaFile = {}
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const norm = validateAndNormalizePath(k)
      if (!norm) continue
      if (!v || typeof v !== 'object') continue
      const ent = v as Record<string, unknown>
      const entry: PageMetaEntry = {}
      const rawSlugs = ent.viewRoleSlugs
      if (Array.isArray(rawSlugs)) {
        const slugs = [
          ...new Set(
            rawSlugs
              .filter((x): x is string => typeof x === 'string')
              .map((s) => s.trim())
              .filter(Boolean)
              .filter((s) => /^[a-z0-9][a-z0-9_-]*$/.test(s))
          ),
        ].sort()
        if (slugs.length > 0) {
          entry.viewRoleSlugs = slugs.slice(0, MAX_VIEW_ROLE_SLUGS)
        }
      }
      if (ent.showSectionPages === false) {
        entry.showSectionPages = false
      }
      const rawTitle = ent.title
      if (typeof rawTitle === 'string') {
        const t = truncateMaxCodePoints(rawTitle.trim(), 200)
        if (t) entry.title = t
      }
      const pruned = prunePageMetaEntry(entry)
      if (pruned) {
        out[norm] = pruned
      }
    }
    return out
  } catch {
    return {}
  }
}

function writePageMeta(wikiRoot: string, meta: PageMetaFile): void {
  try {
    fs.mkdirSync(wikiRoot, { recursive: true })
  } catch {
    /* exists */
  }
  fs.writeFileSync(pageMetaFilePath(wikiRoot), JSON.stringify(meta, null, 2), 'utf8')
}

function getPageViewRoleSlugs(meta: PageMetaFile, normalizedPath: string): string[] {
  const m = meta[normalizedPath]
  const slugs = m?.viewRoleSlugs
  if (!Array.isArray(slugs) || slugs.length === 0) return []
  return slugs
}

function userMatchesViewRoles(userRoles: string[] | undefined, requiredSlugs: string[]): boolean {
  if (requiredSlugs.length === 0) return true
  const set = new Set(userRoles ?? [])
  return requiredSlugs.some((s) => set.has(s))
}

/** Path prefixes from root segment through full path: `a/b/c` → `a`, `a/b`, `a/b/c`. */
function wikiPathPrefixes(normalizedPath: string): string[] {
  const segs = normalizedPath.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i <= segs.length; i++) {
    out.push(segs.slice(0, i).join('/'))
  }
  return out
}

/**
 * True if the user may view this path as a reader. Any ancestor with viewRoleSlugs
 * must allow the user; otherwise children are hidden even when the child page has no meta.
 * `bypassViewRoles` is only for full admins (`*`) where the caller explicitly allows it (e.g. recycle).
 */
function userCanViewWikiPage(
  meta: PageMetaFile,
  normalizedPath: string,
  userRoles: string[] | undefined,
  bypassViewRoles: boolean
): boolean {
  if (bypassViewRoles) return true
  for (const prefix of wikiPathPrefixes(normalizedPath)) {
    const required = getPageViewRoleSlugs(meta, prefix)
    if (required.length > 0 && !userMatchesViewRoles(userRoles, required)) {
      return false
    }
  }
  return true
}

function renamePageMetaKey(wikiRoot: string, fromNorm: string, toNorm: string): void {
  if (fromNorm === toNorm) return
  const meta = readPageMeta(wikiRoot)
  const entry = meta[fromNorm]
  delete meta[fromNorm]
  if (entry) {
    const pruned = prunePageMetaEntry(entry)
    if (pruned) {
      meta[toNorm] = pruned
    }
  }
  writePageMeta(wikiRoot, meta)
}

function deletePageMetaEntry(wikiRoot: string, normalizedPath: string): void {
  const meta = readPageMeta(wikiRoot)
  if (meta[normalizedPath]) {
    delete meta[normalizedPath]
    writePageMeta(wikiRoot, meta)
  }
}

function wikiRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const levelsUp = here.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
  const root = path.resolve(here, ...Array(levelsUp).fill('..'))
  return path.join(root, 'content', 'wiki')
}

function validateAndNormalizePath(raw: string): string | null {
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

function wikiFlatMdPath(wikiRoot: string, normalized: string): string {
  return path.resolve(path.join(wikiRoot, ...normalized.split('/')) + '.md')
}

function wikiIndexMdPath(wikiRoot: string, normalized: string): string {
  return path.resolve(path.join(wikiRoot, ...normalized.split('/'), 'index.md'))
}

function wikiDirPath(wikiRoot: string, normalized: string): string {
  return path.resolve(path.join(wikiRoot, ...normalized.split('/')))
}

function underWikiRoot(wikiRoot: string, abs: string): boolean {
  const root = path.resolve(wikiRoot)
  const rootSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  return abs.startsWith(rootSep)
}

function isMarkdownFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile()
  } catch {
    return false
  }
}

function isExistingDir(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory()
  } catch {
    return false
  }
}

/**
 * Existing page on disk: `path.md` or directory page `path/index.md`
 * (children/grandchildren live as `path/child-name.md` under the same folder).
 */
function resolveExistingPageFile(wikiRoot: string, pagePath: string): string | null {
  const normalized = validateAndNormalizePath(pagePath)
  if (!normalized) return null
  const flat = wikiFlatMdPath(wikiRoot, normalized)
  const idx = wikiIndexMdPath(wikiRoot, normalized)
  if (!underWikiRoot(wikiRoot, flat) || !underWikiRoot(wikiRoot, idx)) return null
  if (isMarkdownFile(flat)) return flat
  if (isMarkdownFile(idx)) return idx
  return null
}

/** True when the resolved file is `path/index.md` (section index), not a flat `path.md`. */
function resolvedPathIsSectionIndex(
  wikiRoot: string,
  normalized: string,
  resolvedAbs: string
): boolean {
  return path.resolve(resolvedAbs) === path.resolve(wikiIndexMdPath(wikiRoot, normalized))
}

/** Write target: prefer existing file; else folder + index when directory exists; else new `path.md`. */
function resolveWriteMarkdownPath(wikiRoot: string, pagePath: string): string | null {
  const normalized = validateAndNormalizePath(pagePath)
  if (!normalized) return null
  const flat = wikiFlatMdPath(wikiRoot, normalized)
  const idx = wikiIndexMdPath(wikiRoot, normalized)
  const dir = wikiDirPath(wikiRoot, normalized)
  if (!underWikiRoot(wikiRoot, flat) || !underWikiRoot(wikiRoot, idx)) return null
  if (isMarkdownFile(flat)) return flat
  if (isMarkdownFile(idx)) return idx
  if (isExistingDir(dir)) return idx
  return flat
}

function wikiOrderFilePath(wikiRoot: string): string {
  return path.join(wikiRoot, SIDEBAR_ORDER_FILENAME)
}

function readSidebarOrder(wikiRoot: string): Record<string, string[]> {
  const fp = wikiOrderFilePath(wikiRoot)
  try {
    const raw = fs.readFileSync(fp, 'utf8')
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return {}
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof k !== 'string') continue
      if (k !== '' && validateAndNormalizePath(k) == null) continue
      if (!Array.isArray(v)) continue
      const segs = v.filter((x): x is string => typeof x === 'string' && SEGMENT_RE.test(x))
      out[k] = segs
    }
    return out
  } catch {
    return {}
  }
}

function validateOrderParentKey(k: string): boolean {
  return k === '' || validateAndNormalizePath(k) != null
}

function firstHeadingTitle(md: string): string | undefined {
  const line = md.split(/\r?\n/).find((l) => l.trim().startsWith('#'))
  if (!line) return undefined
  return truncateMaxCodePoints(line.replace(/^#+\s*/, '').trim(), 200) || undefined
}

function collectMarkdownPaths(dir: string, wikiRoot: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '_deleted') continue
      collectMarkdownPaths(full, wikiRoot, out)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      let pagePath: string
      if (e.name.toLowerCase() === 'index.md') {
        const relDir = path.relative(wikiRoot, dir).replace(/\\/g, '/')
        pagePath = !relDir || relDir === '.' ? 'index' : relDir
      } else {
        const rel = path.relative(wikiRoot, full).replace(/\\/g, '/')
        pagePath = rel.slice(0, -3)
      }
      if (validateAndNormalizePath(pagePath)) out.push(pagePath)
    }
  }
}

/** Paths for this page and any descendant pages under the same section tree (same normalized prefix). */
function wikiPathsUnderPrefix(wikiRoot: string, prefixNorm: string): string[] {
  const all: string[] = []
  collectMarkdownPaths(wikiRoot, wikiRoot, all)
  return all.filter((p) => p === prefixNorm || p.startsWith(`${prefixNorm}/`))
}

/**
 * GET /api/wiki/slug-suggestion?parentPath=&title=
 * POST /api/wiki/slug-suggestion  { parentPath?: string, title: string }
 * Returns a sibling-unique final segment under parentPath (normalized wiki path, empty = root).
 */
router.get('/slug-suggestion', authMiddleware, requirePermission('module.wiki'), (req, res) => {
  const title = typeof req.query.title === 'string' ? req.query.title : ''
  const parentRaw = typeof req.query.parentPath === 'string' ? req.query.parentPath : ''
  const wikiRoot = wikiRootDir()
  if (!title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  const parentNorm =
    parentRaw.trim() === '' ? '' : validateAndNormalizePath(parentRaw.replace(/^\/+|\/+$/g, ''))
  if (parentRaw.trim() !== '' && parentNorm == null) {
    return res.status(400).json({ error: 'Invalid parentPath' })
  }
  try {
    fs.mkdirSync(wikiRoot, { recursive: true })
  } catch {
    /* exists */
  }
  const slug = suggestAvailableWikiSlugSegment(wikiRoot, parentNorm ?? '', title)
  return res.json({ slug })
})

/** Role labels for wiki page visibility (editors setting allowed viewers). */
router.get(
  '/role-options',
  authMiddleware,
  requirePermission('wiki.edit'),
  asyncRoute(async (_req: AuthRequest, res) => {
    try {
      const rows = (await db.prepare('SELECT slug, label FROM roles ORDER BY slug').all()) as Array<{
        slug: string
        label: string
      }>
      res.json(rows)
    } catch {
      res.status(500).json({ error: 'Failed to load roles' })
    }
  })
)

router.post('/slug-suggestion', authMiddleware, requirePermission('module.wiki'), (req, res) => {
  const body = req.body as { title?: unknown; parentPath?: unknown }
  const title = typeof body?.title === 'string' ? body.title : ''
  const parentRaw = typeof body?.parentPath === 'string' ? body.parentPath : ''
  const wikiRoot = wikiRootDir()
  if (!title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  const parentNorm =
    parentRaw.trim() === '' ? '' : validateAndNormalizePath(parentRaw.replace(/^\/+|\/+$/g, ''))
  if (parentRaw.trim() !== '' && parentNorm == null) {
    return res.status(400).json({ error: 'Invalid parentPath' })
  }
  try {
    fs.mkdirSync(wikiRoot, { recursive: true })
  } catch {
    /* exists */
  }
  const slug = suggestAvailableWikiSlugSegment(wikiRoot, parentNorm ?? '', title)
  return res.json({ slug })
})

/** GET /api/wiki/pages */
router.get('/pages', authMiddleware, requirePermission('module.wiki'), (req: AuthRequest, res) => {
  const wikiRoot = wikiRootDir()
  try {
    fs.mkdirSync(wikiRoot, { recursive: true })
  } catch {
    /* may already exist */
  }
  const paths: string[] = []
  if (fs.existsSync(wikiRoot)) {
    collectMarkdownPaths(wikiRoot, wikiRoot, paths)
  }
  const unique = [...new Set(paths)].sort((a, b) => a.localeCompare(b))
  const meta = readPageMeta(wikiRoot)
  const list = unique
    .map((p) => {
      let title: string | undefined
      try {
        const abs = resolveExistingPageFile(wikiRoot, p)
        if (!abs) {
          return { path: p, title }
        }
        const md = fs.readFileSync(abs, 'utf8')
        const fromMeta = meta[p]?.title
        const fromHeading = firstHeadingTitle(md)
        title = (fromMeta && fromMeta.trim() ? fromMeta : undefined) ?? fromHeading
      } catch {
        /* skip title */
      }
      return { path: p, title }
    })
    .filter((item) => userCanViewWikiPage(meta, item.path, req.user?.roles, false))
  res.json(list)
})

/** GET /api/wiki/order — persisted sibling order for sidebar (parent path -> child segments). */
router.get('/order', authMiddleware, requirePermission('module.wiki'), (_req, res) => {
  const wikiRoot = wikiRootDir()
  try {
    fs.mkdirSync(wikiRoot, { recursive: true })
  } catch {
    /* exists */
  }
  res.json(readSidebarOrder(wikiRoot))
})

/** PUT /api/wiki/order  body: { orders: Record<string, string[]> } merges entries for each parent path key. */
router.put('/order', authMiddleware, requirePermission('wiki.edit'), (req, res) => {
  const wikiRoot = wikiRootDir()
  try {
    fs.mkdirSync(wikiRoot, { recursive: true })
  } catch {
    /* exists */
  }
  const body = req.body as { orders?: unknown }
  if (!body.orders || typeof body.orders !== 'object' || body.orders === null) {
    return res.status(400).json({ error: 'orders must be an object' })
  }
  const existing = readSidebarOrder(wikiRoot)
  const incomingOrders = body.orders as Record<string, unknown>
  for (const [parentKey, segments] of Object.entries(incomingOrders)) {
    if (typeof parentKey !== 'string' || !validateOrderParentKey(parentKey)) {
      continue
    }
    if (!Array.isArray(segments)) {
      return res.status(400).json({ error: `orders[${parentKey}] must be an array of segment strings` })
    }
    const norm: string[] = []
    for (const seg of segments) {
      if (typeof seg === 'string' && SEGMENT_RE.test(seg)) norm.push(seg)
    }
    const normalizedParent = parentKey === '' ? '' : validateAndNormalizePath(parentKey)!
    existing[normalizedParent] = norm
  }
  try {
    fs.writeFileSync(wikiOrderFilePath(wikiRoot), JSON.stringify(existing, null, 2), 'utf8')
    return res.json({ ok: true })
  } catch {
    return res.status(500).json({ error: 'Failed to save sidebar order' })
  }
})

/** GET /api/wiki/page?path=foo/bar */
router.get('/page', authMiddleware, requirePermission('module.wiki'), (req: AuthRequest, res) => {
  const raw = typeof req.query.path === 'string' ? req.query.path : ''
  const wikiRoot = wikiRootDir()
  if (!validateAndNormalizePath(raw)) {
    return res.status(400).json({ error: 'Invalid path' })
  }
  const abs = resolveExistingPageFile(wikiRoot, raw)
  if (!abs) {
    return res.status(404).json({ error: 'Page not found' })
  }
  try {
    const markdown = fs.readFileSync(abs, 'utf8')
    const normalized = validateAndNormalizePath(raw)!
    const meta = readPageMeta(wikiRoot)
    if (!userCanViewWikiPage(meta, normalized, req.user?.roles, false)) {
      return res.status(403).json({
        error:
          'You do not have access to this page or section. A parent folder may require roles you do not have.',
      })
    }
    const required = getPageViewRoleSlugs(meta, normalized)
    const pageKind = resolvedPathIsSectionIndex(wikiRoot, normalized, abs) ? 'section' : 'page'
    const showSectionPages =
      pageKind === 'section' ? meta[normalized]?.showSectionPages !== false : true
    const pageTitle = meta[normalized]?.title?.trim()
      ? meta[normalized]!.title
      : null
    return res.json({
      path: normalized,
      markdown,
      pageKind,
      pageTitle,
      viewRoleSlugs: required.length > 0 ? [...required] : null,
      showSectionPages,
    })
  } catch {
    return res.status(500).json({ error: 'Failed to read page' })
  }
})

/** PUT /api/wiki/page?path=foo/bar  body: { markdown: string }  Optional ?as=index creates path/index.md (new section). */
router.put('/page', authMiddleware, requirePermission('wiki.edit'), asyncRoute(async (req: AuthRequest, res) => {
  const raw = typeof req.query.path === 'string' ? req.query.path : ''
  const wantIndex =
    typeof req.query.as === 'string' && req.query.as.toLowerCase() === 'index'
  const wikiRoot = wikiRootDir()
  if (!validateAndNormalizePath(raw)) {
    return res.status(400).json({ error: 'Invalid path' })
  }
  let abs: string | null
  if (wantIndex) {
    const normalized = validateAndNormalizePath(raw)!
    const flat = wikiFlatMdPath(wikiRoot, normalized)
    const idx = wikiIndexMdPath(wikiRoot, normalized)
    if (!underWikiRoot(wikiRoot, flat) || !underWikiRoot(wikiRoot, idx)) {
      return res.status(400).json({ error: 'Invalid path' })
    }
    if (isMarkdownFile(flat)) {
      return res
        .status(409)
        .json({ error: 'A page already exists at this path as a single file. Remove it or pick another path.' })
    }
    if (isMarkdownFile(idx)) {
      return res
        .status(409)
        .json({ error: 'A section or index page already exists at this path.' })
    }
    abs = idx
  } else {
    abs = resolveWriteMarkdownPath(wikiRoot, raw)
    if (!abs) {
      return res.status(400).json({ error: 'Invalid path' })
    }
  }
  const body = req.body as {
    markdown?: unknown
    viewRoleSlugs?: unknown
    showSectionPages?: unknown
    pageTitle?: unknown
  }
  if (typeof body?.markdown !== 'string') {
    return res.status(400).json({ error: 'markdown must be a string' })
  }
  const markdown = body.markdown
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    return res.status(400).json({ error: `markdown exceeds ${MAX_MARKDOWN_CHARS} characters` })
  }

  const normalized = validateAndNormalizePath(raw)!
  const metaAcl = readPageMeta(wikiRoot)
  if (!userCanViewWikiPage(metaAcl, normalized, req.user?.roles, false)) {
    return res.status(403).json({
      error:
        'You do not have access to this page or section. A parent folder may require roles you do not have.',
    })
  }

  let shouldUpdateViewRoles = false
  let rolesToStore: string[] | null = null
  if ('viewRoleSlugs' in body) {
    shouldUpdateViewRoles = true
    const vr = body.viewRoleSlugs
    if (vr === null || vr === undefined) {
      rolesToStore = null
    } else if (Array.isArray(vr)) {
      const cleaned = [...new Set(vr.map((x) => String(x).trim()).filter(Boolean))]
      if (cleaned.length > MAX_VIEW_ROLE_SLUGS) {
        return res.status(400).json({ error: `At most ${MAX_VIEW_ROLE_SLUGS} roles per page` })
      }
      for (const s of cleaned) {
        if (!(await roleSlugExists(db, s))) {
          return res.status(400).json({ error: `Unknown role: ${s}` })
        }
      }
      rolesToStore = cleaned.length > 0 ? [...cleaned].sort() : null
    } else {
      return res.status(400).json({ error: 'viewRoleSlugs must be an array or null' })
    }
  }

  let shouldUpdateShowSectionPages = false
  let showSectionPagesToStore: boolean | undefined
  if ('showSectionPages' in body) {
    const sp = body.showSectionPages
    if (sp !== null && sp !== undefined && typeof sp !== 'boolean') {
      return res.status(400).json({ error: 'showSectionPages must be a boolean or omitted' })
    }
    shouldUpdateShowSectionPages = true
    showSectionPagesToStore = sp === false ? false : true
  }

  let shouldUpdatePageTitle = false
  let pageTitleToStore: string | null = null
  if ('pageTitle' in body) {
    shouldUpdatePageTitle = true
    const pt = body.pageTitle
    if (pt === null || pt === undefined) {
      pageTitleToStore = null
    } else if (typeof pt === 'string') {
      const t = truncateMaxCodePoints(pt.trim(), 200)
      pageTitleToStore = t || null
    } else {
      return res.status(400).json({ error: 'pageTitle must be a string or null' })
    }
  }

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, markdown, 'utf8')
    const pageKindAfter = resolvedPathIsSectionIndex(wikiRoot, normalized, abs) ? 'section' : 'page'

    if (shouldUpdateViewRoles || shouldUpdateShowSectionPages || shouldUpdatePageTitle) {
      const meta = readPageMeta(wikiRoot)
      const prev = meta[normalized] ?? {}
      const entry: PageMetaEntry = { ...prev }

      if (shouldUpdateViewRoles) {
        if (rolesToStore?.length) {
          entry.viewRoleSlugs = rolesToStore
        } else {
          delete entry.viewRoleSlugs
        }
      }

      if (shouldUpdateShowSectionPages && pageKindAfter === 'section') {
        if (showSectionPagesToStore === true) {
          delete entry.showSectionPages
        } else {
          entry.showSectionPages = false
        }
      }

      if (shouldUpdatePageTitle) {
        if (pageTitleToStore) {
          entry.title = pageTitleToStore
        } else {
          delete entry.title
        }
      }

      const pruned = prunePageMetaEntry(entry)
      if (!pruned) {
        delete meta[normalized]
      } else {
        meta[normalized] = pruned
      }
      writePageMeta(wikiRoot, meta)
    }

    const metaAfter = readPageMeta(wikiRoot)
    const slugsOut = getPageViewRoleSlugs(metaAfter, normalized)
    const showSectionPagesOut =
      pageKindAfter === 'section' ? metaAfter[normalized]?.showSectionPages !== false : true
    const pageTitleOut = metaAfter[normalized]?.title?.trim()
      ? metaAfter[normalized]!.title
      : null
    return res.json({
      path: normalized,
      pageTitle: pageTitleOut,
      viewRoleSlugs: slugsOut.length > 0 ? slugsOut : null,
      showSectionPages: showSectionPagesOut,
    })
  } catch {
    return res.status(500).json({ error: 'Failed to save page' })
  }
}))

function parentWikiPath(normalized: string): string {
  const segs = normalized.split('/').filter(Boolean)
  if (segs.length <= 1) return ''
  return segs.slice(0, -1).join('/')
}

function lastWikiSegment(normalized: string): string {
  const segs = normalized.split('/').filter(Boolean)
  return segs[segs.length - 1] ?? ''
}

function applyMoveToSidebarOrder(
  order: Record<string, string[]>,
  fromNorm: string,
  toNorm: string
): Record<string, string[]> {
  const fromPar = parentWikiPath(fromNorm)
  const toPar = parentWikiPath(toNorm)
  const fromSeg = lastWikiSegment(fromNorm)
  const toSeg = lastWikiSegment(toNorm)
  const next: Record<string, string[]> = { ...order }
  const getArr = (k: string) => [...(next[k] ?? [])]
  const setArr = (k: string, arr: string[]) => {
    if (arr.length) next[k] = arr
    else delete next[k]
  }
  if (fromPar === toPar) {
    const arr0 = getArr(fromPar)
    const ix = arr0.indexOf(fromSeg)
    let arr: string[]
    if (ix !== -1) {
      arr = arr0.map((s) => (s === fromSeg ? toSeg : s))
    } else {
      arr = [...arr0.filter((s) => s !== toSeg), toSeg]
    }
    setArr(fromPar, arr)
    return next
  }
  const fromArr = getArr(fromPar).filter((s) => s !== fromSeg)
  setArr(fromPar, fromArr)
  const toArr = [...getArr(toPar).filter((s) => s !== toSeg), toSeg]
  setArr(toPar, toArr)
  return next
}

/**
 * PUT /api/wiki/move  body: { from: string, to: string }
 * Renames a wiki page (flat .md) or section folder (…/index.md + subtree) on disk.
 */
router.put('/move', authMiddleware, requirePermission('wiki.edit'), (req: AuthRequest, res) => {
  const wikiRoot = wikiRootDir()
  const body = req.body as { from?: unknown; to?: unknown }
  const fromRaw = typeof body.from === 'string' ? body.from : ''
  const toRaw = typeof body.to === 'string' ? body.to : ''
  const fromNorm = validateAndNormalizePath(fromRaw)
  const toNorm = validateAndNormalizePath(toRaw)
  if (!fromNorm || !toNorm) {
    return res.status(400).json({ error: 'Invalid from or to path' })
  }
  if (fromNorm === toNorm) {
    return res.status(400).json({ error: 'Source and destination are the same' })
  }
  if (toNorm.startsWith(`${fromNorm}/`)) {
    return res.status(400).json({ error: 'Cannot move a path into itself' })
  }
  const src = resolveExistingPageFile(wikiRoot, fromNorm)
  if (!src) {
    return res.status(404).json({ error: 'Source page not found' })
  }

  const metaMove = readPageMeta(wikiRoot)
  if (!userCanViewWikiPage(metaMove, fromNorm, req.user?.roles, false)) {
    return res.status(403).json({
      error:
        'You do not have access to the source path. A parent folder may require roles you do not have.',
    })
  }
  if (!userCanViewWikiPage(metaMove, toNorm, req.user?.roles, false)) {
    return res.status(403).json({
      error:
        'You do not have access to the destination path. A parent folder may require roles you do not have.',
    })
  }

  const dstFlat = wikiFlatMdPath(wikiRoot, toNorm)
  const dstIdx = wikiIndexMdPath(wikiRoot, toNorm)
  const dstDir = wikiDirPath(wikiRoot, toNorm)
  if (!underWikiRoot(wikiRoot, dstFlat) || !underWikiRoot(wikiRoot, dstDir)) {
    return res.status(400).json({ error: 'Invalid destination' })
  }
  if (isMarkdownFile(dstFlat) || isMarkdownFile(dstIdx) || isExistingDir(dstDir)) {
    return res.status(409).json({ error: 'Something already exists at the destination path' })
  }

  const idxFrom = wikiIndexMdPath(wikiRoot, fromNorm)
  const isSectionMove = path.resolve(src) === path.resolve(idxFrom)

  try {
    if (isSectionMove) {
      const srcDir = wikiDirPath(wikiRoot, fromNorm)
      if (!isExistingDir(srcDir)) {
        return res.status(500).json({ error: 'Section folder missing' })
      }
      fs.mkdirSync(path.dirname(dstDir), { recursive: true })
      fs.renameSync(srcDir, dstDir)
    } else {
      fs.mkdirSync(path.dirname(dstFlat), { recursive: true })
      fs.renameSync(src, dstFlat)
    }

    renamePageMetaKey(wikiRoot, fromNorm, toNorm)

    const orderPath = wikiOrderFilePath(wikiRoot)
    try {
      const order = readSidebarOrder(wikiRoot)
      const merged = applyMoveToSidebarOrder(order, fromNorm, toNorm)
      fs.writeFileSync(orderPath, JSON.stringify(merged, null, 2), 'utf8')
    } catch {
      /* order file optional */
    }

    return res.json({ path: toNorm })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Move failed'
    return res.status(500).json({ error: msg })
  }
})

function resolveStorageUnderWikiRoot(wikiRoot: string, storageRel: string): { abs: string; rel: string } | null {
  const norm = storageRel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!norm.startsWith('_deleted/')) return null
  const abs = path.resolve(wikiRoot, ...norm.split('/'))
  const deletedRoot = path.resolve(wikiRoot, '_deleted')
  const delSep = deletedRoot.endsWith(path.sep) ? deletedRoot : `${deletedRoot}${path.sep}`
  if (!abs.startsWith(delSep)) return null
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
  return { abs, rel: norm }
}

/** GET /api/wiki/recycle — list soft-deleted pages under _deleted/ (manifest + inferred paths). */
router.get(
  '/recycle',
  authMiddleware,
  requirePermission('module.wiki'),
  requirePermission('wiki.recycle'),
  asyncRoute(async (req: AuthRequest, res) => {
    const wikiRoot = wikiRootDir()
    try {
      fs.mkdirSync(wikiRoot, { recursive: true })
    } catch {
      /* */
    }
    const liveMeta = readPageMeta(wikiRoot)
    const manifest = readWikiRecycleManifest(wikiRoot)
    const files = listDeletedWikiMarkdownFiles(wikiRoot)
    const userPerms = req.user?.permissions ?? []
    const listBypass = roleHasPermission(userPerms, '*')
    const out: Array<{
      storageRel: string
      wikiPath: string
      deletedAt: string
      title?: string
    }> = []

    for (const { abs, rel } of files) {
      const man = manifest[rel]
      const wikiPath = man?.wikiPath || wikiPathFromDeletedStorageRel(rel)
      if (!wikiPath) continue
      const merged: PageMetaFile = { ...liveMeta }
      if (man?.viewRoleSlugs && man.viewRoleSlugs.length > 0) {
        merged[wikiPath] = { ...merged[wikiPath], viewRoleSlugs: man.viewRoleSlugs }
      }
      if (!userCanViewWikiPage(merged, wikiPath, req.user?.roles, listBypass)) continue

      let title: string | undefined = man?.title?.trim()
      if (!title) {
        try {
          const md = fs.readFileSync(abs, 'utf8')
          title = firstHeadingTitle(md)
        } catch {
          /* */
        }
      }
      const deletedAt =
        man?.deletedAt && man.deletedAt.trim()
          ? man.deletedAt
          : fs.statSync(abs).mtime.toISOString()
      out.push({ storageRel: rel, wikiPath, deletedAt, title })
    }

    out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0))
    const retentionDays = await getWikiRecycleRetentionDays()
    res.json({ items: out, retentionDays })
  })
)

/** POST /api/wiki/recycle/restore body: { storageRel } */
router.post(
  '/recycle/restore',
  authMiddleware,
  requirePermission('module.wiki'),
  requirePermission('wiki.recycle'),
  asyncRoute(async (req: AuthRequest, res) => {
    const storageRel = typeof (req.body as { storageRel?: unknown })?.storageRel === 'string'
      ? (req.body as { storageRel: string }).storageRel.trim()
      : ''
    if (!storageRel) {
      return res.status(400).json({ error: 'storageRel is required' })
    }
    if (!req.user || !roleHasPermission(req.user.permissions, 'wiki.edit')) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const wikiRoot = wikiRootDir()
    const resolved = resolveStorageUnderWikiRoot(wikiRoot, storageRel)
    if (!resolved) {
      return res.status(400).json({ error: 'Invalid or missing storage path' })
    }
    const manifest = readWikiRecycleManifest(wikiRoot)
    const man = manifest[resolved.rel]
    const wikiPath = man?.wikiPath || wikiPathFromDeletedStorageRel(resolved.rel)
    if (!wikiPath) {
      return res.status(400).json({ error: 'Could not resolve wiki path' })
    }
    const liveMeta = readPageMeta(wikiRoot)
    const merged: PageMetaFile = { ...liveMeta }
    if (man?.viewRoleSlugs && man.viewRoleSlugs.length > 0) {
      merged[wikiPath] = { ...merged[wikiPath], viewRoleSlugs: man.viewRoleSlugs }
    }
    if (!userCanViewWikiPage(merged, wikiPath, req.user.roles, roleHasPermission(req.user.permissions, '*'))) {
      return res.status(404).json({ error: 'Not found' })
    }

    const wasIndex = path.basename(resolved.abs).toLowerCase() === 'index.md'
    const destFlat = wikiFlatMdPath(wikiRoot, wikiPath)
    const destIdx = wikiIndexMdPath(wikiRoot, wikiPath)
    const dest = wasIndex ? destIdx : destFlat
    if (!underWikiRoot(wikiRoot, dest)) {
      return res.status(400).json({ error: 'Invalid destination' })
    }
    if (fs.existsSync(dest)) {
      return res.status(409).json({ error: 'A page already exists at the restore target' })
    }

    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(resolved.abs, dest)
    } catch {
      return res.status(500).json({ error: 'Failed to restore page' })
    }

    const meta = readPageMeta(wikiRoot)
    const next: PageMetaFile = { ...meta }
    const ent: PageMetaEntry = {}
    if (man?.viewRoleSlugs && man.viewRoleSlugs.length > 0) {
      ent.viewRoleSlugs = man.viewRoleSlugs
    }
    if (man?.title && man.title.trim()) {
      ent.title = truncateMaxCodePoints(man.title.trim(), 200)
    }
    if (wasIndex && man?.showSectionPages === false) {
      ent.showSectionPages = false
    }
    const pruned = prunePageMetaEntry(ent)
    if (pruned) {
      next[wikiPath] = pruned
    } else {
      delete next[wikiPath]
    }
    writePageMeta(wikiRoot, next)
    removeWikiRecycleManifestEntry(wikiRoot, resolved.rel)

    return res.json({ ok: true, path: wikiPath })
  })
)

/** DELETE /api/wiki/recycle/permanent body: { storageRel } */
router.delete(
  '/recycle/permanent',
  authMiddleware,
  requirePermission('module.wiki'),
  requirePermission('wiki.recycle'),
  asyncRoute(async (req: AuthRequest, res) => {
    const storageRel = typeof (req.body as { storageRel?: unknown })?.storageRel === 'string'
      ? (req.body as { storageRel: string }).storageRel.trim()
      : ''
    if (!storageRel) {
      return res.status(400).json({ error: 'storageRel is required' })
    }
    if (!req.user || !roleHasPermission(req.user.permissions, 'wiki.edit')) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const wikiRoot = wikiRootDir()
    const resolved = resolveStorageUnderWikiRoot(wikiRoot, storageRel)
    if (!resolved) {
      return res.status(400).json({ error: 'Invalid or missing storage path' })
    }
    const manifest = readWikiRecycleManifest(wikiRoot)
    const man = manifest[resolved.rel]
    const wikiPath = man?.wikiPath || wikiPathFromDeletedStorageRel(resolved.rel)
    if (!wikiPath) {
      return res.status(400).json({ error: 'Could not resolve wiki path' })
    }
    const liveMeta = readPageMeta(wikiRoot)
    const merged: PageMetaFile = { ...liveMeta }
    if (man?.viewRoleSlugs && man.viewRoleSlugs.length > 0) {
      merged[wikiPath] = { ...merged[wikiPath], viewRoleSlugs: man.viewRoleSlugs }
    }
    if (!userCanViewWikiPage(merged, wikiPath, req.user.roles, roleHasPermission(req.user.permissions, '*'))) {
      return res.status(404).json({ error: 'Not found' })
    }

    try {
      fs.unlinkSync(resolved.abs)
      removeWikiRecycleManifestEntry(wikiRoot, resolved.rel)
      const deletedRoot = path.resolve(wikiRoot, '_deleted')
      let parent = path.dirname(resolved.abs)
      while (parent.startsWith(deletedRoot + path.sep) || parent === deletedRoot) {
        try {
          const left = fs.readdirSync(parent)
          if (left.length > 0) break
          fs.rmdirSync(parent)
        } catch {
          break
        }
        if (parent === deletedRoot) break
        parent = path.dirname(parent)
      }
    } catch {
      return res.status(500).json({ error: 'Failed to delete file' })
    }
    return res.json({ ok: true })
  })
)

/** DELETE /api/wiki/page?path=foo/bar — moves file to content/wiki/_deleted/... (no hard delete). */
router.delete('/page', authMiddleware, requirePermission('wiki.edit'), (_req: AuthRequest, res) => {
  const raw = typeof _req.query.path === 'string' ? _req.query.path : ''
  const wikiRoot = wikiRootDir()
  if (!validateAndNormalizePath(raw)) {
    return res.status(400).json({ error: 'Invalid path' })
  }
  const normalized = validateAndNormalizePath(raw)!
  const src = resolveExistingPageFile(wikiRoot, raw)
  if (!src) {
    return res.status(404).json({ error: 'Page not found' })
  }
  const metaDel = readPageMeta(wikiRoot)
  if (!userCanViewWikiPage(metaDel, normalized, _req.user?.roles, false)) {
    return res.status(403).json({
      error:
        'You do not have access to this page or section. A parent folder may require roles you do not have.',
    })
  }
  for (const p of wikiPathsUnderPrefix(wikiRoot, normalized)) {
    if (!userCanViewWikiPage(metaDel, p, _req.user?.roles, false)) {
      return res.status(403).json({
        error:
          'Cannot delete this page because the section contains other pages you do not have access to. Remove or move those pages first, or ask an administrator.',
      })
    }
  }
  try {
    const wikiRootResolved = path.resolve(wikiRoot)
    const deletedRoot = path.resolve(path.join(wikiRootResolved, '_deleted'))
    const relFromWiki = path.relative(wikiRootResolved, path.resolve(src))
    if (relFromWiki.startsWith('..') || path.isAbsolute(relFromWiki)) {
      return res.status(500).json({ error: 'Invalid source path' })
    }
    const resolvedDest = path.resolve(path.join(deletedRoot, relFromWiki))
    const delRootSep = deletedRoot.endsWith(path.sep) ? deletedRoot : `${deletedRoot}${path.sep}`
    if (!resolvedDest.startsWith(delRootSep)) {
      return res.status(500).json({ error: 'Invalid destination' })
    }
    fs.mkdirSync(path.dirname(resolvedDest), { recursive: true })
    let finalDest = resolvedDest
    if (fs.existsSync(finalDest)) {
      const ext = path.extname(finalDest)
      const base = finalDest.slice(0, -ext.length)
      finalDest = `${base}-${Date.now()}${ext}`
    }
    fs.renameSync(src, finalDest)
    const metaBefore = readPageMeta(wikiRoot)
    const entryMeta = metaBefore[normalized] ?? {}
    const finalRel = path.relative(wikiRootResolved, path.resolve(finalDest)).replace(/\\/g, '/')
    upsertWikiRecycleManifestEntry(wikiRoot, finalRel, {
      wikiPath: normalized,
      deletedAt: new Date().toISOString(),
      ...(entryMeta.viewRoleSlugs && entryMeta.viewRoleSlugs.length > 0
        ? { viewRoleSlugs: entryMeta.viewRoleSlugs }
        : {}),
      ...(entryMeta.title && entryMeta.title.trim() ? { title: entryMeta.title.trim() } : {}),
      ...(entryMeta.showSectionPages === false ? { showSectionPages: false } : {}),
    })
    deletePageMetaEntry(wikiRoot, normalized)
    const rel = finalRel
    return res.json({ ok: true, movedTo: rel })
  } catch {
    return res.status(500).json({ error: 'Failed to move page to deleted folder' })
  }
})

/** Embedded images in wiki markdown; served from `/api/uploads/wiki/…` (static mount). */
const WIKI_IMAGE_UPLOAD_SEGMENT = 'wiki'

function wikiImageUploadsDir(): string {
  return path.join(process.cwd(), 'uploads', WIKI_IMAGE_UPLOAD_SEGMENT)
}

function sanitizeWikiImageFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'image'
  return base.slice(0, 200)
}

const wikiImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = wikiImageUploadsDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    const safe = sanitizeWikiImageFilename(path.basename(file.originalname, path.extname(file.originalname)))
    if (safe && safe !== 'image') {
      let final = safe + ext.toLowerCase()
      let n = 0
      const dir = wikiImageUploadsDir()
      while (fs.existsSync(path.join(dir, final))) {
        n += 1
        final = `${safe}_${n}${ext.toLowerCase()}`
      }
      cb(null, final)
    } else {
      cb(null, `${uuidv4()}${ext.toLowerCase()}`)
    }
  },
})

const wikiImageUpload = multer({
  storage: wikiImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp|heic)$/i
    if (allowed.test(file.mimetype)) cb(null, true)
    else cb(new Error('Only images (jpeg, png, gif, webp, heic) allowed'))
  },
})

router.post(
  '/upload-image',
  authMiddleware,
  requirePermission('wiki.edit'),
  wikiImageUpload.array('images', 20),
  (req: AuthRequest, res: Response) => {
    const raw = req.files
    const list = Array.isArray(raw) ? raw : []
    if (list.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' })
    }
    const paths = list.map((f) => `/api/uploads/${WIKI_IMAGE_UPLOAD_SEGMENT}/${f.filename}`)
    res.json({ paths })
  }
)

export { router as wikiRouter }
