import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router, type Response } from 'express'
import multer from 'multer'
import { db } from '../db/index.js'
import {
  authMiddleware,
  requireAnyPermission,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.js'
import { roleHasPermission } from '../lib/permissionsCatalog.js'
import { isValidLinkRequiredPermission } from '../lib/permissionsCatalog.js'
import { roleSlugExists } from '../lib/userRoles.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()

const HOME_KEY = 'home_page'

export interface HomeCustomLink {
  id: string
  title: string
  description: string
  href: string
  /** If non-empty, only users with at least one of these roles see the link. */
  allowedRoleSlugs?: string[]
  /** @deprecated Use allowedRoleSlugs when possible. */
  requiredPermission?: string
  /** Optional group for hub / `/links` headings; must reference `linkCategories`. */
  categoryId?: string | null
  /** When false, link appears only on `/links`, not as a card on the home hub. Default true. */
  showOnHome?: boolean
  /** Order among links shown on the home hub (lower first). Independent of category / full list order. */
  homeSortOrder?: number
}

export interface HomeLinkCategory {
  id: string
  title: string
  sortOrder: number
}

export interface HomePagePayload {
  introMarkdown: string
  customLinks: HomeCustomLink[]
  linkCategories: HomeLinkCategory[]
  /** Display order for home module cards; full list of known module ids. */
  moduleOrder: string[]
  /** Known module ids hidden from home cards only (sidebar/routes unchanged). */
  modulesHiddenFromHome: string[]
  showWelcomeLogo?: boolean
  welcomeLogoMaxRem?: number
  /** Path under repo `uploads/` (e.g. `home/welcome-logo.png`). Null/omit = built-in `public/logo.png`. */
  welcomeLogoPath?: string | null
  /** Same; null = built-in `public/icon.png` for tab / PWA icon. */
  siteFaviconPath?: string | null
  /** Bumped when either branding path changes (cache bust for `/api/uploads/...`). */
  homeBrandingRevision?: number
  /** Hub shows this many link cards before “view all”; Links manager edits this. */
  customLinksInitialVisibleCount?: number
  /** Home hub custom link cards: 1–6 equal-width columns. */
  homeHubLinkColumns?: number
  /** `/links` directory: 1–6 columns per category section (flow layout). */
  linksPageLinkColumns?: number
  /** @deprecated Per-column slots; prefer `homeHubCategoryColumnMap`. */
  homeHubColumnCategoryIds?: (string | null)[]
  /** Category id → home hub column index (0-based). */
  homeHubCategoryColumnMap?: Record<string, number>
  /** Column for uncategorized / unmatched links; null omits explicit targeting. */
  homeHubOtherLinksColumn?: number | null
}

const MAX_LINKS = 40
const MAX_INTRO_MARKDOWN = 50_000

/** Accept booleans and a few string/number forms (proxies, old clients, hand-edited JSON). */
function coerceHomeBool(v: unknown): boolean {
  if (v === true) return true
  if (v === false || v == null) return false
  if (typeof v === 'number') return v === 1
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes'
  }
  return false
}

const WELCOME_LOGO_MIN_REM = 8
const WELCOME_LOGO_MAX_REM = 28
const WELCOME_LOGO_DEFAULT_REM = 16

/** Bounds must match `src/lib/welcomeLogoSize.ts`. */
function coerceWelcomeLogoMaxRem(v: unknown): number {
  let n: number
  if (typeof v === 'number' && Number.isFinite(v)) {
    n = v
  } else if (typeof v === 'string' && v.trim() !== '') {
    const p = parseFloat(v)
    n = Number.isFinite(p) ? p : WELCOME_LOGO_DEFAULT_REM
  } else {
    return WELCOME_LOGO_DEFAULT_REM
  }
  const stepped = Math.round(n * 2) / 2
  return Math.min(WELCOME_LOGO_MAX_REM, Math.max(WELCOME_LOGO_MIN_REM, stepped))
}

function readDefaultIntroFromRepoFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const levelsUp = here.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
  const root = path.resolve(here, ...Array(levelsUp).fill('..'))
  const file = path.join(root, 'content', 'home-intro.md')
  try {
    const text = fs.readFileSync(file, 'utf8').trim()
    if (text.length > 0) return text.slice(0, MAX_INTRO_MARKDOWN)
  } catch {
    /* missing or unreadable */
  }
  return 'Choose a module to continue.'
}

/** Must stay aligned with `appModules` ids in `src/config/modules.ts`. */
const HOME_MODULE_IDS: string[] = ['testing', 'locations', 'wiki', 'files', 'admin']
const HOME_MODULE_ID_SET = new Set(HOME_MODULE_IDS)

function normalizeModuleOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...HOME_MODULE_IDS]
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const id = x.trim()
    if (!HOME_MODULE_ID_SET.has(id) || seen.has(id)) continue
    out.push(id)
    seen.add(id)
  }
  for (const id of HOME_MODULE_IDS) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}

function normalizeModulesHiddenFromHome(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const id = x.trim()
    if (!HOME_MODULE_ID_SET.has(id) || seen.has(id)) continue
    out.push(id)
    seen.add(id)
  }
  return out
}

const DEFAULT_CUSTOM_LINKS_VISIBLE = 8
const MIN_CUSTOM_LINKS_VISIBLE = 1
const MAX_CUSTOM_LINKS_VISIBLE = 40

const DEFAULT_HOME_HUB_LINK_COLUMNS = 1
const MIN_HOME_HUB_LINK_COLUMNS = 1
const MAX_HOME_HUB_LINK_COLUMNS = 6

/** Must match `src/lib/homeLinkVisibility.ts` `HUB_COLUMN_OTHER`. */
const HUB_COLUMN_OTHER = '__hub_other__'

const DEFAULT_KV_HOME = {
  introMarkdown: readDefaultIntroFromRepoFile(),
  showWelcomeLogo: false,
  welcomeLogoMaxRem: WELCOME_LOGO_DEFAULT_REM,
  moduleOrder: [...HOME_MODULE_IDS],
  modulesHiddenFromHome: [] as string[],
  welcomeLogoPath: null as string | null,
  siteFaviconPath: null as string | null,
  homeBrandingRevision: 0,
  customLinksInitialVisibleCount: DEFAULT_CUSTOM_LINKS_VISIBLE,
  homeHubLinkColumns: DEFAULT_HOME_HUB_LINK_COLUMNS,
  linksPageLinkColumns: DEFAULT_HOME_HUB_LINK_COLUMNS,
  homeHubColumnCategoryIds: [] as (string | null)[],
  homeHubCategoryColumnMap: {} as Record<string, number>,
  homeHubOtherLinksColumn: null as number | null,
}

const DEFAULT_HOME: HomePagePayload = {
  introMarkdown: DEFAULT_KV_HOME.introMarkdown,
  customLinks: [],
  linkCategories: [],
  moduleOrder: [...HOME_MODULE_IDS],
  modulesHiddenFromHome: [],
  showWelcomeLogo: DEFAULT_KV_HOME.showWelcomeLogo,
  welcomeLogoMaxRem: DEFAULT_KV_HOME.welcomeLogoMaxRem,
  customLinksInitialVisibleCount: DEFAULT_KV_HOME.customLinksInitialVisibleCount,
  homeHubLinkColumns: DEFAULT_KV_HOME.homeHubLinkColumns,
  linksPageLinkColumns: DEFAULT_KV_HOME.linksPageLinkColumns,
  homeHubColumnCategoryIds: [...DEFAULT_KV_HOME.homeHubColumnCategoryIds],
  homeHubCategoryColumnMap: { ...DEFAULT_KV_HOME.homeHubCategoryColumnMap },
  homeHubOtherLinksColumn: DEFAULT_KV_HOME.homeHubOtherLinksColumn,
}
const MAX_LINK_TITLE = 120
const MAX_LINK_DESC = 400
const MAX_HREF = 2000
const MAX_ROLE_SLUGS_PER_LINK = 32
const MAX_CATEGORY_TITLE = 120
const MAX_LINK_CATEGORIES = 40

const HOME_ASSET_PATH_RE = /^home\/[a-zA-Z0-9._-]+$/
const MAX_WELCOME_LOGO_BYTES = 2 * 1024 * 1024
const MAX_SITE_FAVICON_BYTES = 512 * 1024
const HOME_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

function uploadsRootDir(): string {
  return path.resolve(process.cwd(), 'uploads')
}

function homeUploadsDir(): string {
  const d = path.join(uploadsRootDir(), 'home')
  fs.mkdirSync(d, { recursive: true })
  return d
}

function extFromHomeImageMime(m: string): string | null {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  }
  return map[m] ?? null
}

function homeAssetFileExists(rel: string): boolean {
  if (!HOME_ASSET_PATH_RE.test(rel)) return false
  const abs = path.resolve(uploadsRootDir(), ...rel.split('/'))
  const root = uploadsRootDir()
  if (!abs.startsWith(root)) return false
  return fs.existsSync(abs)
}

function deleteHomeBrandingFiles(base: 'welcome-logo' | 'site-favicon') {
  const dir = path.join(uploadsRootDir(), 'home')
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${base}.`)) {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch {
        /* ignore */
      }
    }
  }
}

function readStoredAssetPath(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || !HOME_ASSET_PATH_RE.test(t)) return null
  return t
}

function coerceHomeRevision(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.min(1_000_000_000, Math.floor(v))
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10)
    if (Number.isFinite(n) && n >= 0) return Math.min(1_000_000_000, n)
  }
  return 0
}

function coerceCustomLinksInitialVisibleCount(v: unknown, prev: number): number {
  let n: number
  if (typeof v === 'number' && Number.isFinite(v)) {
    n = Math.floor(v)
  } else if (typeof v === 'string' && v.trim() !== '') {
    const p = parseInt(v, 10)
    n = Number.isFinite(p) ? p : prev
  } else {
    return prev
  }
  return Math.min(MAX_CUSTOM_LINKS_VISIBLE, Math.max(MIN_CUSTOM_LINKS_VISIBLE, n))
}

function coerceHomeHubLinkColumns(v: unknown, prev: number): number {
  let n: number
  if (typeof v === 'number' && Number.isFinite(v)) {
    n = Math.floor(v)
  } else if (typeof v === 'string' && v.trim() !== '') {
    const p = parseInt(v, 10)
    n = Number.isFinite(p) ? p : prev
  } else {
    return prev
  }
  return Math.min(MAX_HOME_HUB_LINK_COLUMNS, Math.max(MIN_HOME_HUB_LINK_COLUMNS, n))
}

function normalizeHomeHubColumnCategoryIdsRead(
  raw: unknown,
  columnCount: number
): (string | null)[] {
  const n = Math.min(
    MAX_HOME_HUB_LINK_COLUMNS,
    Math.max(MIN_HOME_HUB_LINK_COLUMNS, Math.floor(columnCount))
  )
  const out: (string | null)[] = []
  const arr = Array.isArray(raw) ? raw : []
  for (let i = 0; i < n; i++) {
    const v = i < arr.length ? arr[i] : null
    if (v === HUB_COLUMN_OTHER) {
      out.push(HUB_COLUMN_OTHER)
    } else if (v == null || (typeof v === 'string' && v.trim() === '')) {
      out.push(null)
    } else if (typeof v === 'string') {
      out.push(v.trim().slice(0, 80))
    } else {
      out.push(null)
    }
  }
  return out
}

function coerceHomeHubColumnCategoryIds(
  raw: unknown,
  columnCount: number,
  prev: (string | null)[],
  allowedCategoryIds: Set<string>
): (string | null)[] {
  const n = Math.min(
    MAX_HOME_HUB_LINK_COLUMNS,
    Math.max(MIN_HOME_HUB_LINK_COLUMNS, Math.floor(columnCount))
  )
  const src = Array.isArray(raw) ? raw : prev
  const out: (string | null)[] = []
  const usedCats = new Set<string>()
  for (let i = 0; i < n; i++) {
    const v = i < src.length ? src[i] : undefined
    if (v === HUB_COLUMN_OTHER || v === '__hub_other__') {
      out.push(HUB_COLUMN_OTHER)
      continue
    }
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
      out.push(null)
      continue
    }
    if (typeof v === 'string') {
      const id = v.trim().slice(0, 80)
      if (allowedCategoryIds.has(id) && !usedCats.has(id)) {
        usedCats.add(id)
        out.push(id)
      } else {
        out.push(null)
      }
      continue
    }
    out.push(null)
  }
  return out
}

function migrateLegacyHubColumnArrayToMap(
  legacy: (string | null)[],
  columnCount: number
): { map: Record<string, number>; other: number | null } {
  const map: Record<string, number> = {}
  let other: number | null = null
  const n = Math.min(
    MAX_HOME_HUB_LINK_COLUMNS,
    Math.max(MIN_HOME_HUB_LINK_COLUMNS, Math.floor(columnCount))
  )
  for (let i = 0; i < Math.min(legacy.length, n); i++) {
    const v = legacy[i]
    if (v === HUB_COLUMN_OTHER) other = i
    else if (typeof v === 'string' && v.trim()) map[v.trim().slice(0, 80)] = i
  }
  return { map, other }
}

function parseHomeHubCategoryColumnMapRead(
  raw: unknown,
  columnCount: number,
  allowedIds?: Set<string>
): Record<string, number> {
  const n = Math.min(
    MAX_HOME_HUB_LINK_COLUMNS,
    Math.max(MIN_HOME_HUB_LINK_COLUMNS, Math.floor(columnCount))
  )
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const o = raw as Record<string, unknown>
  for (const [key, val] of Object.entries(o)) {
    const id = typeof key === 'string' ? key.trim().slice(0, 80) : ''
    if (!id || (allowedIds && !allowedIds.has(id))) continue
    let col: number
    if (typeof val === 'number' && Number.isFinite(val)) col = Math.floor(val)
    else if (typeof val === 'string' && val.trim() !== '') {
      const p = parseInt(val.trim(), 10)
      col = Number.isFinite(p) ? p : NaN
    } else continue
    if (!Number.isFinite(col)) continue
    out[id] = Math.min(n - 1, Math.max(0, col))
  }
  return out
}

function parseHomeHubOtherLinksColumnRead(raw: unknown, columnCount: number): number | null {
  const n = Math.min(
    MAX_HOME_HUB_LINK_COLUMNS,
    Math.max(MIN_HOME_HUB_LINK_COLUMNS, Math.floor(columnCount))
  )
  if (n <= 0) return null
  if (raw === undefined || raw === null || raw === '') return null
  const num = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : parseInt(String(raw), 10)
  if (!Number.isFinite(num)) return null
  return Math.min(n - 1, Math.max(0, num))
}

function coerceHomeHubCategoryColumnMap(
  raw: unknown,
  columnCount: number,
  prev: Record<string, number>,
  allowedCategoryIds: Set<string>
): Record<string, number> {
  const n = Math.min(
    MAX_HOME_HUB_LINK_COLUMNS,
    Math.max(MIN_HOME_HUB_LINK_COLUMNS, Math.floor(columnCount))
  )
  if (raw === undefined) {
    const out: Record<string, number> = {}
    for (const cid of allowedCategoryIds) {
      const v = prev[cid]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      out[cid] = Math.min(n - 1, Math.max(0, Math.floor(v)))
    }
    return out
  }
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: Record<string, number> = {}
  for (const cid of allowedCategoryIds) {
    if (!(cid in src)) continue
    const v = src[cid]
    let col: number
    if (typeof v === 'number' && Number.isFinite(v)) col = Math.floor(v)
    else if (typeof v === 'string' && v.trim() !== '') {
      const p = parseInt(v.trim(), 10)
      col = Number.isFinite(p) ? p : NaN
    } else continue
    if (!Number.isFinite(col)) continue
    out[cid] = Math.min(n - 1, Math.max(0, col))
  }
  return out
}

function coerceHomeHubOtherLinksColumn(
  raw: unknown,
  columnCount: number,
  prev: number | null
): number | null {
  const n = Math.min(
    MAX_HOME_HUB_LINK_COLUMNS,
    Math.max(MIN_HOME_HUB_LINK_COLUMNS, Math.floor(columnCount))
  )
  if (n <= 0) return null
  if (raw === undefined) return prev
  if (raw === null || raw === '') return null
  const num =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.floor(raw)
      : typeof raw === 'string' && raw.trim() !== ''
        ? parseInt(raw.trim(), 10)
        : NaN
  if (!Number.isFinite(num)) return prev
  return Math.min(n - 1, Math.max(0, num))
}

function renumberHomeHubSortOrders(links: HomeCustomLink[]): HomeCustomLink[] {
  const onHome = links.filter((l) => l.showOnHome !== false)
  const sorted = [...onHome].sort(
    (a, b) =>
      (a.homeSortOrder ?? 0) - (b.homeSortOrder ?? 0) || a.id.localeCompare(b.id)
  )
  const rank = new Map(sorted.map((l, i) => [l.id, i]))
  return links.map((l) =>
    l.showOnHome !== false ? { ...l, homeSortOrder: rank.get(l.id)! } : l
  )
}

/** Enforce at most `max` links with show-on-home; extras drop off the end of hub order. */
function clampCustomLinksShowOnHome(links: HomeCustomLink[], max: number): HomeCustomLink[] {
  const m = Math.min(
    MAX_CUSTOM_LINKS_VISIBLE,
    Math.max(MIN_CUSTOM_LINKS_VISIBLE, Math.floor(max))
  )
  const wanting = links.filter((l) => l.showOnHome !== false)
  const sortedWanting = [...wanting].sort(
    (a, b) =>
      (a.homeSortOrder ?? 0) - (b.homeSortOrder ?? 0) || a.id.localeCompare(b.id)
  )
  const keepIds = new Set(sortedWanting.slice(0, m).map((l) => l.id))
  const clamped = links.map((link) => {
    if (link.showOnHome === false) return link
    if (keepIds.has(link.id)) return { ...link, showOnHome: true }
    return { ...link, showOnHome: false }
  })
  return renumberHomeHubSortOrders(clamped)
}

function normalizeNullableAssetPath(
  raw: unknown,
  prev: string | null,
  fieldLabel: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: prev }
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `${fieldLabel} must be a string or null` }
  const t = raw.trim()
  if (t === '') return { ok: true, value: null }
  if (!HOME_ASSET_PATH_RE.test(t)) return { ok: false, error: `Invalid ${fieldLabel} path` }
  if (!homeAssetFileExists(t)) {
    return {
      ok: false,
      error: `${fieldLabel} file is missing. Upload the image again or choose the default.`,
    }
  }
  return { ok: true, value: t }
}

function publicHomeAssetPath(stored: string | null | undefined): string | null {
  const p = readStoredAssetPath(stored)
  if (!p) return null
  return homeAssetFileExists(p) ? p : null
}

function homeImageFileFilter(_req: AuthRequest, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (HOME_IMAGE_MIMES.has(file.mimetype)) {
    cb(null, true)
    return
  }
  cb(new Error('Allowed types: PNG, JPEG, WebP, GIF, SVG'))
}

function makeHomeImageStorage(base: 'welcome-logo' | 'site-favicon') {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, homeUploadsDir())
    },
    filename: (_req, file, cb) => {
      const ext = extFromHomeImageMime(file.mimetype)
      if (!ext) {
        cb(new Error('Unsupported image type'), '')
        return
      }
      try {
        deleteHomeBrandingFiles(base)
      } catch {
        /* ignore */
      }
      cb(null, `${base}.${ext}`)
    },
  })
}

const welcomeLogoUpload = multer({
  storage: makeHomeImageStorage('welcome-logo'),
  limits: { fileSize: MAX_WELCOME_LOGO_BYTES },
  fileFilter: homeImageFileFilter,
})

const siteFaviconUpload = multer({
  storage: makeHomeImageStorage('site-favicon'),
  limits: { fileSize: MAX_SITE_FAVICON_BYTES },
  fileFilter: homeImageFileFilter,
})

function handleHomeUploadError(err: unknown, res: Response) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large' })
      return
    }
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message })
    return
  }
  res.status(400).json({ error: 'Upload failed' })
}

function isValidHref(href: string): boolean {
  const t = href.trim()
  if (!t || t.length > MAX_HREF) return false
  if (/^https?:\/\//i.test(t)) return true
  if (t.startsWith('mailto:')) return true
  if (t.startsWith('/')) return !t.includes('//')
  return false
}

/** Home intro, logo, module order (custom links live in `home_links`). */
function parseHomeKv(raw: string | undefined): Omit<HomePagePayload, 'customLinks' | 'linkCategories'> {
  if (!raw) return { ...DEFAULT_KV_HOME }
  try {
    const j = JSON.parse(raw) as Partial<HomePagePayload> & {
      introTitle?: string
      introSubtitle?: string
    }
    let introMarkdown =
      typeof j.introMarkdown === 'string' ? j.introMarkdown : ''
    if (introMarkdown.trim() === '' && typeof j.introSubtitle === 'string') {
      introMarkdown = j.introSubtitle
    }
    if (introMarkdown.trim() === '' && typeof j.introTitle === 'string' && j.introTitle.trim()) {
      introMarkdown = `# ${j.introTitle.trim()}\n\n${typeof j.introSubtitle === 'string' ? j.introSubtitle : ''}`.trim()
    }
    if (introMarkdown.trim() === '') introMarkdown = DEFAULT_KV_HOME.introMarkdown
    const showWelcomeLogo = coerceHomeBool(j.showWelcomeLogo)
    const welcomeLogoMaxRem = coerceWelcomeLogoMaxRem(j.welcomeLogoMaxRem)
    const moduleOrder = normalizeModuleOrder(j.moduleOrder)
    const modulesHiddenFromHome = normalizeModulesHiddenFromHome(
      (j as { modulesHiddenFromHome?: unknown }).modulesHiddenFromHome
    )
    const customLinksInitialVisibleCount = coerceCustomLinksInitialVisibleCount(
      (j as { customLinksInitialVisibleCount?: unknown }).customLinksInitialVisibleCount,
      DEFAULT_KV_HOME.customLinksInitialVisibleCount
    )
    const homeHubLinkColumns = coerceHomeHubLinkColumns(
      (j as { homeHubLinkColumns?: unknown }).homeHubLinkColumns,
      DEFAULT_KV_HOME.homeHubLinkColumns
    )
    const linksPageLinkColumns = coerceHomeHubLinkColumns(
      (j as { linksPageLinkColumns?: unknown }).linksPageLinkColumns,
      homeHubLinkColumns
    )
    const homeHubColumnCategoryIds = normalizeHomeHubColumnCategoryIdsRead(
      (j as { homeHubColumnCategoryIds?: unknown }).homeHubColumnCategoryIds,
      homeHubLinkColumns
    )
    let homeHubCategoryColumnMap = parseHomeHubCategoryColumnMapRead(
      (j as { homeHubCategoryColumnMap?: unknown }).homeHubCategoryColumnMap,
      homeHubLinkColumns
    )
    let homeHubOtherLinksColumn = parseHomeHubOtherLinksColumnRead(
      (j as { homeHubOtherLinksColumn?: unknown }).homeHubOtherLinksColumn,
      homeHubLinkColumns
    )
    const hasNewLayout =
      Object.keys(homeHubCategoryColumnMap).length > 0 || homeHubOtherLinksColumn !== null
    if (!hasNewLayout && homeHubColumnCategoryIds.some((x) => x != null)) {
      const mig = migrateLegacyHubColumnArrayToMap(homeHubColumnCategoryIds, homeHubLinkColumns)
      homeHubCategoryColumnMap = mig.map
      homeHubOtherLinksColumn = mig.other
    }
    return {
      introMarkdown,
      showWelcomeLogo,
      welcomeLogoMaxRem,
      moduleOrder,
      modulesHiddenFromHome,
      welcomeLogoPath: readStoredAssetPath(j.welcomeLogoPath),
      siteFaviconPath: readStoredAssetPath(j.siteFaviconPath),
      homeBrandingRevision: coerceHomeRevision(j.homeBrandingRevision),
      customLinksInitialVisibleCount,
      homeHubLinkColumns,
      linksPageLinkColumns,
      homeHubColumnCategoryIds,
      homeHubCategoryColumnMap,
      homeHubOtherLinksColumn,
    }
  } catch {
    return { ...DEFAULT_KV_HOME }
  }
}

async function loadLinkCategoriesFromDb(): Promise<HomeLinkCategory[]> {
  const rows = (await db
    .prepare(
      `SELECT id, title, sort_order FROM home_link_categories ORDER BY sort_order ASC, id ASC`
    )
    .all()) as Array<{
    id: string
    title: string
    sort_order: number
  }>
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sortOrder: r.sort_order,
  }))
}

async function loadCustomLinksFromDb(): Promise<HomeCustomLink[]> {
  const rows = (await db
    .prepare(
      `SELECT id, title, description, href, allowed_role_slugs, required_permission, sort_order, category_id, show_on_home, home_sort_order
       FROM home_links ORDER BY sort_order ASC, id ASC`
    )
    .all()) as Array<{
    id: string
    title: string
    description: string
    href: string
    allowed_role_slugs: string | null
    required_permission: string | null
    sort_order: number
    category_id: string | null
    show_on_home: number | null
    home_sort_order: number
  }>
  const legacyHubSort =
    rows.length > 0 && rows.every((r) => Number(r.home_sort_order ?? 0) === 0)
  const out: HomeCustomLink[] = []
  for (const r of rows) {
    const base: HomeCustomLink = {
      id: r.id,
      title: r.title,
      description: r.description ?? '',
      href: r.href,
    }
    if (r.show_on_home === 0) {
      base.showOnHome = false
    }
    const hs = legacyHubSort ? r.sort_order : Number(r.home_sort_order ?? 0)
    base.homeSortOrder = hs
    if (typeof r.category_id === 'string' && r.category_id.trim()) {
      base.categoryId = r.category_id.trim()
    }
    if (r.allowed_role_slugs) {
      try {
        const arr = JSON.parse(r.allowed_role_slugs) as unknown
        if (Array.isArray(arr)) {
          const slugs = arr.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
          if (slugs.length > 0) base.allowedRoleSlugs = [...new Set(slugs)]
        }
      } catch {
        /* skip malformed */
      }
    }
    if (typeof r.required_permission === 'string' && r.required_permission.trim()) {
      base.requiredPermission = r.required_permission.trim()
    }
    out.push(base)
  }
  return out
}

async function replaceLinksInDb(links: HomeCustomLink[]) {
  await db.prepare('DELETE FROM home_links').run()
  const ins = db.prepare(`
    INSERT INTO home_links (id, title, description, href, allowed_role_slugs, required_permission, sort_order, category_id, home_sort_order, show_on_home)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let sortOrder = 0
  for (const link of links) {
    const homeSort =
      typeof link.homeSortOrder === 'number' && Number.isFinite(link.homeSortOrder)
        ? Math.floor(link.homeSortOrder)
        : sortOrder
    await ins.run(
      link.id,
      link.title,
      link.description,
      link.href,
      link.allowedRoleSlugs?.length ? JSON.stringify(link.allowedRoleSlugs) : null,
      link.requiredPermission ?? null,
      sortOrder,
      link.categoryId?.trim() ? link.categoryId.trim() : null,
      homeSort,
      link.showOnHome === false ? 0 : 1
    )
    sortOrder += 1
  }
}

async function replaceCategoriesInDb(categories: HomeLinkCategory[]) {
  const prevRows = (await db.prepare('SELECT id FROM home_link_categories').all()) as Array<{ id: string }>
  const nextIds = new Set(categories.map((c) => c.id))
  for (const { id } of prevRows) {
    if (!nextIds.has(id)) {
      await db.prepare('UPDATE home_links SET category_id = NULL WHERE category_id = ?').run(id)
    }
  }
  await db.prepare('DELETE FROM home_link_categories').run()
  const ins = db.prepare(
    `INSERT INTO home_link_categories (id, title, sort_order) VALUES (?, ?, ?)`
  )
  for (const c of categories) {
    await ins.run(c.id, c.title.trim().slice(0, MAX_CATEGORY_TITLE), c.sortOrder)
  }
}

type HomeKvParsed = ReturnType<typeof parseHomeKv>

type PutSections = {
  touchKv: boolean
  touchLinks: boolean
  touchCategories: boolean
  touchLinkKv: boolean
}

function detectPutSections(b: Record<string, unknown>): PutSections {
  const kvKeys = [
    'introMarkdown',
    'introTitle',
    'introSubtitle',
    'showWelcomeLogo',
    'welcomeLogoMaxRem',
    'moduleOrder',
    'modulesHiddenFromHome',
    'welcomeLogoPath',
    'siteFaviconPath',
  ]
  return {
    touchKv: kvKeys.some((k) => k in b),
    touchLinks: 'customLinks' in b,
    touchCategories: 'linkCategories' in b,
    touchLinkKv:
      'customLinksInitialVisibleCount' in b ||
      'homeHubLinkColumns' in b ||
      'linksPageLinkColumns' in b ||
      'homeHubColumnCategoryIds' in b ||
      'homeHubCategoryColumnMap' in b ||
      'homeHubOtherLinksColumn' in b,
  }
}

function mergeKvFromBody(
  b: Record<string, unknown>,
  prevKv: HomeKvParsed
): { ok: true; kv: HomeKvParsed } | { ok: false; error: string } {
  let introMarkdown = prevKv.introMarkdown
  if ('introMarkdown' in b || 'introSubtitle' in b || 'introTitle' in b) {
    let im = ''
    if (typeof b.introMarkdown === 'string') {
      im = b.introMarkdown.trim().slice(0, MAX_INTRO_MARKDOWN)
    } else if (typeof b.introSubtitle === 'string') {
      im = b.introSubtitle.trim().slice(0, MAX_INTRO_MARKDOWN)
    }
    if (im === '' && typeof b.introTitle === 'string' && b.introTitle.trim()) {
      im = `# ${b.introTitle.trim().slice(0, 200)}`
    }
    if (im !== '') introMarkdown = im
  }

  const showWelcomeLogo =
    'showWelcomeLogo' in b ? coerceHomeBool(b.showWelcomeLogo) : prevKv.showWelcomeLogo
  const welcomeLogoMaxRem =
    'welcomeLogoMaxRem' in b ? coerceWelcomeLogoMaxRem(b.welcomeLogoMaxRem) : prevKv.welcomeLogoMaxRem

  let moduleOrder = prevKv.moduleOrder
  if ('moduleOrder' in b && b.moduleOrder !== undefined && b.moduleOrder !== null) {
    if (!Array.isArray(b.moduleOrder)) return { ok: false, error: 'moduleOrder must be an array' }
    moduleOrder = normalizeModuleOrder(b.moduleOrder)
  }

  let modulesHiddenFromHome = prevKv.modulesHiddenFromHome
  if ('modulesHiddenFromHome' in b && b.modulesHiddenFromHome !== undefined && b.modulesHiddenFromHome !== null) {
    if (!Array.isArray(b.modulesHiddenFromHome)) {
      return { ok: false, error: 'modulesHiddenFromHome must be an array' }
    }
    modulesHiddenFromHome = normalizeModulesHiddenFromHome(b.modulesHiddenFromHome)
  }

  const wPath =
    'welcomeLogoPath' in b
      ? normalizeNullableAssetPath(b.welcomeLogoPath, prevKv.welcomeLogoPath ?? null, 'Welcome logo')
      : { ok: true as const, value: prevKv.welcomeLogoPath ?? null }
  if (!wPath.ok) return wPath

  const fPath =
    'siteFaviconPath' in b
      ? normalizeNullableAssetPath(b.siteFaviconPath, prevKv.siteFaviconPath ?? null, 'Site favicon')
      : { ok: true as const, value: prevKv.siteFaviconPath ?? null }
  if (!fPath.ok) return fPath

  let rev = coerceHomeRevision(prevKv.homeBrandingRevision)
  const prevW = prevKv.welcomeLogoPath ?? null
  const nextW = wPath.value
  const prevF = prevKv.siteFaviconPath ?? null
  const nextF = fPath.value
  if (prevW !== nextW || prevF !== nextF) rev += 1

  return {
    ok: true,
    kv: {
      introMarkdown,
      showWelcomeLogo,
      welcomeLogoMaxRem,
      moduleOrder,
      modulesHiddenFromHome,
      welcomeLogoPath: wPath.value,
      siteFaviconPath: fPath.value,
      homeBrandingRevision: rev,
      customLinksInitialVisibleCount: prevKv.customLinksInitialVisibleCount,
      homeHubLinkColumns: prevKv.homeHubLinkColumns,
      linksPageLinkColumns: prevKv.linksPageLinkColumns,
      homeHubColumnCategoryIds: prevKv.homeHubColumnCategoryIds,
      homeHubCategoryColumnMap: prevKv.homeHubCategoryColumnMap,
      homeHubOtherLinksColumn: prevKv.homeHubOtherLinksColumn,
    },
  }
}

function parseLinkCategoriesArray(
  raw: unknown
): { ok: true; data: HomeLinkCategory[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'linkCategories must be an array' }
  const data: HomeLinkCategory[] = []
  let ord = 0
  for (const item of raw.slice(0, MAX_LINK_CATEGORIES)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 80) : randomUUID()
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, MAX_CATEGORY_TITLE) : ''
    if (!title) continue
    let sortOrder = ord
    if (typeof o.sortOrder === 'number' && Number.isFinite(o.sortOrder)) {
      sortOrder = Math.floor(o.sortOrder)
    } else if (typeof o.sortOrder === 'string' && o.sortOrder.trim() !== '') {
      const p = parseInt(o.sortOrder, 10)
      if (Number.isFinite(p)) sortOrder = p
    }
    data.push({ id, title, sortOrder })
    ord += 1
  }
  return { ok: true, data }
}

async function parseCustomLinksArray(
  raw: unknown,
  allowedCategoryIds: Set<string>
): Promise<{ ok: true; data: HomeCustomLink[] } | { ok: false; error: string }> {
  if (!Array.isArray(raw)) return { ok: false, error: 'customLinks must be an array' }
  const customLinks: HomeCustomLink[] = []
  for (const item of raw.slice(0, MAX_LINKS)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 80) : randomUUID()
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, MAX_LINK_TITLE) : ''
    const description = typeof o.description === 'string' ? o.description.trim().slice(0, MAX_LINK_DESC) : ''
    const href = typeof o.href === 'string' ? o.href.trim() : ''
    if (!title || !href) continue
    if (!isValidHref(href)) return { ok: false, error: `Invalid href for link "${title}"` }

    let categoryId: string | null | undefined
    if ('categoryId' in o) {
      if (o.categoryId === undefined || o.categoryId === null) {
        categoryId = null
      } else if (typeof o.categoryId === 'string') {
        const cid = o.categoryId.trim()
        if (cid) {
          if (!allowedCategoryIds.has(cid)) {
            return { ok: false, error: `Unknown category for link "${title}"` }
          }
          categoryId = cid
        } else {
          categoryId = null
        }
      } else {
        return { ok: false, error: `categoryId must be a string or null for link "${title}"` }
      }
    }

    let allowedRoleSlugs: string[] | undefined
    if (o.allowedRoleSlugs !== undefined && o.allowedRoleSlugs !== null) {
      if (!Array.isArray(o.allowedRoleSlugs)) {
        return { ok: false, error: `allowedRoleSlugs must be an array for link "${title}"` }
      }
      const rawSlugs = o.allowedRoleSlugs
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_ROLE_SLUGS_PER_LINK)
      const uniq = [...new Set(rawSlugs)].sort()
      for (const s of uniq) {
        if (!(await roleSlugExists(db, s))) {
          return { ok: false, error: `Unknown role "${s}" for link "${title}"` }
        }
      }
      allowedRoleSlugs = uniq.length > 0 ? uniq : undefined
    }

    let requiredPermission: string | undefined
    if (!allowedRoleSlugs?.length && o.requiredPermission !== undefined && o.requiredPermission !== null) {
      if (typeof o.requiredPermission !== 'string' || !o.requiredPermission.trim()) {
        requiredPermission = undefined
      } else {
        const rp = o.requiredPermission.trim()
        if (!isValidLinkRequiredPermission(rp)) {
          return { ok: false, error: `Invalid requiredPermission for link "${title}"` }
        }
        requiredPermission = rp
      }
    }

    const link: HomeCustomLink = {
      id,
      title,
      description,
      href,
      showOnHome: 'showOnHome' in o ? coerceHomeBool(o.showOnHome) : true,
    }
    if ('homeSortOrder' in o && o.homeSortOrder != null) {
      const rawHs = o.homeSortOrder
      const hs =
        typeof rawHs === 'number' && Number.isFinite(rawHs)
          ? Math.floor(rawHs)
          : typeof rawHs === 'string' && rawHs.trim() !== ''
            ? parseInt(rawHs.trim(), 10)
            : NaN
      if (Number.isFinite(hs)) link.homeSortOrder = hs
    }
    if (categoryId !== undefined) {
      link.categoryId = categoryId
    }
    if (allowedRoleSlugs?.length) {
      link.allowedRoleSlugs = allowedRoleSlugs
    } else if (requiredPermission) {
      link.requiredPermission = requiredPermission
    }
    customLinks.push(link)
  }
  return { ok: true, data: customLinks }
}

/** Slug/label pairs for home link visibility (editors may not have users.manage). */
router.get(
  '/role-options',
  authMiddleware,
  requireAnyPermission('home.edit', 'links.edit'),
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

/** Public read: home hub is shown before login. Mutations require `home.edit` and/or `links.edit`. */
router.get(
  '/',
  asyncRoute(async (_req, res) => {
    const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(HOME_KEY)) as
      | { value: string }
      | undefined
    const kv = parseHomeKv(row?.value)
    res.json({
      introMarkdown: kv.introMarkdown,
      customLinks: await loadCustomLinksFromDb(),
      linkCategories: await loadLinkCategoriesFromDb(),
      moduleOrder: kv.moduleOrder,
      modulesHiddenFromHome: kv.modulesHiddenFromHome,
      showWelcomeLogo: kv.showWelcomeLogo,
      welcomeLogoMaxRem: kv.welcomeLogoMaxRem,
      welcomeLogoPath: publicHomeAssetPath(kv.welcomeLogoPath),
      siteFaviconPath: publicHomeAssetPath(kv.siteFaviconPath),
      homeBrandingRevision: kv.homeBrandingRevision ?? 0,
      customLinksInitialVisibleCount: kv.customLinksInitialVisibleCount ?? DEFAULT_CUSTOM_LINKS_VISIBLE,
      homeHubLinkColumns: kv.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS,
      linksPageLinkColumns: kv.linksPageLinkColumns ?? kv.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS,
      homeHubColumnCategoryIds: kv.homeHubColumnCategoryIds,
      homeHubCategoryColumnMap: kv.homeHubCategoryColumnMap ?? {},
      homeHubOtherLinksColumn:
        kv.homeHubOtherLinksColumn === undefined ? null : kv.homeHubOtherLinksColumn,
    })
  })
)

router.put(
  '/',
  authMiddleware,
  asyncRoute(async (req: AuthRequest, res) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid body' })
    }
    const b = req.body as Record<string, unknown>
    const sections = detectPutSections(b)

    const needHome = sections.touchKv
    const needLinks = sections.touchLinks || sections.touchCategories || sections.touchLinkKv

    if (!needHome && !needLinks) {
      return res.status(400).json({ error: 'No recognized fields to update' })
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    if (needHome && !roleHasPermission(req.user.permissions, 'home.edit')) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (needLinks && !roleHasPermission(req.user.permissions, 'links.edit')) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(HOME_KEY)) as
      | { value: string }
      | undefined
    const prevKv = parseHomeKv(row?.value)

    const prevCats = await loadLinkCategoriesFromDb()
    let nextCats = prevCats
    if (sections.touchCategories) {
      const pc = parseLinkCategoriesArray(b.linkCategories)
      if (!pc.ok) {
        return res.status(400).json({ error: pc.error })
      }
      nextCats = pc.data
    }

    const allowedCategoryIds = new Set(nextCats.map((c) => c.id))

    let nextKv: HomeKvParsed = { ...prevKv }
    if (sections.touchKv) {
      const merged = mergeKvFromBody(b, prevKv)
      if (!merged.ok) {
        return res.status(400).json({ error: merged.error })
      }
      nextKv = merged.kv
    }
    if (sections.touchLinkKv) {
      const mergedCols = coerceHomeHubLinkColumns(
        b.homeHubLinkColumns,
        prevKv.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS
      )
      const mergedLinksPageCols = coerceHomeHubLinkColumns(
        b.linksPageLinkColumns,
        prevKv.linksPageLinkColumns ?? mergedCols
      )
      nextKv = {
        ...nextKv,
        customLinksInitialVisibleCount: coerceCustomLinksInitialVisibleCount(
          b.customLinksInitialVisibleCount,
          prevKv.customLinksInitialVisibleCount ?? DEFAULT_CUSTOM_LINKS_VISIBLE
        ),
        homeHubLinkColumns: mergedCols,
        linksPageLinkColumns: mergedLinksPageCols,
        homeHubCategoryColumnMap: coerceHomeHubCategoryColumnMap(
          b.homeHubCategoryColumnMap,
          mergedCols,
          prevKv.homeHubCategoryColumnMap ?? {},
          allowedCategoryIds
        ),
        homeHubOtherLinksColumn: coerceHomeHubOtherLinksColumn(
          b.homeHubOtherLinksColumn,
          mergedCols,
          prevKv.homeHubOtherLinksColumn ?? null
        ),
        homeHubColumnCategoryIds: coerceHomeHubColumnCategoryIds(
          'homeHubColumnCategoryIds' in b ? b.homeHubColumnCategoryIds : [],
          mergedCols,
          [],
          allowedCategoryIds
        ),
      }
    }

    if (sections.touchCategories) {
      await replaceCategoriesInDb(nextCats)
    }

    if (sections.touchLinks) {
      const catIds = new Set(
        sections.touchCategories ? nextCats.map((c) => c.id) : prevCats.map((c) => c.id)
      )
      const parsed = await parseCustomLinksArray(b.customLinks, catIds)
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error })
      }
      const cap = coerceCustomLinksInitialVisibleCount(
        nextKv.customLinksInitialVisibleCount,
        prevKv.customLinksInitialVisibleCount ?? DEFAULT_CUSTOM_LINKS_VISIBLE
      )
      const toStore = clampCustomLinksShowOnHome(parsed.data, cap)
      await replaceLinksInDb(toStore)
    }

    if (sections.touchKv) {
      const prevW = prevKv.welcomeLogoPath ?? null
      const nextW = nextKv.welcomeLogoPath ?? null
      const prevF = prevKv.siteFaviconPath ?? null
      const nextF = nextKv.siteFaviconPath ?? null
      if (prevW && !nextW) deleteHomeBrandingFiles('welcome-logo')
      if (prevF && !nextF) deleteHomeBrandingFiles('site-favicon')
    }

    if (sections.touchKv || sections.touchLinkKv) {
      await db
        .prepare(
          `INSERT INTO app_kv (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
        )
        .run(HOME_KEY, JSON.stringify(nextKv))
    }

    const kvRow = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(HOME_KEY)) as
      | { value: string }
      | undefined
    const kvOut = parseHomeKv(kvRow?.value)

    res.json({
      introMarkdown: kvOut.introMarkdown,
      customLinks: await loadCustomLinksFromDb(),
      linkCategories: await loadLinkCategoriesFromDb(),
      moduleOrder: kvOut.moduleOrder,
      modulesHiddenFromHome: kvOut.modulesHiddenFromHome,
      showWelcomeLogo: kvOut.showWelcomeLogo,
      welcomeLogoMaxRem: kvOut.welcomeLogoMaxRem,
      welcomeLogoPath: publicHomeAssetPath(kvOut.welcomeLogoPath),
      siteFaviconPath: publicHomeAssetPath(kvOut.siteFaviconPath),
      homeBrandingRevision: kvOut.homeBrandingRevision ?? 0,
      customLinksInitialVisibleCount: kvOut.customLinksInitialVisibleCount ?? DEFAULT_CUSTOM_LINKS_VISIBLE,
      homeHubLinkColumns: kvOut.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS,
      linksPageLinkColumns:
        kvOut.linksPageLinkColumns ?? kvOut.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS,
      homeHubColumnCategoryIds: kvOut.homeHubColumnCategoryIds,
      homeHubCategoryColumnMap: kvOut.homeHubCategoryColumnMap ?? {},
      homeHubOtherLinksColumn:
        kvOut.homeHubOtherLinksColumn === undefined ? null : kvOut.homeHubOtherLinksColumn,
    })
  })
)

router.post(
  '/welcome-logo',
  authMiddleware,
  requirePermission('home.edit'),
  (req: AuthRequest, res, next) => {
    welcomeLogoUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        handleHomeUploadError(err, res)
        return
      }
      next()
    })
  },
  asyncRoute(async (req: AuthRequest, res) => {
    const f = req.file
    if (!f) {
      res.status(400).json({ error: 'No file uploaded (use field name "file")' })
      return
    }
    res.json({ path: `home/${f.filename}` })
  })
)

router.post(
  '/site-favicon',
  authMiddleware,
  requirePermission('home.edit'),
  (req: AuthRequest, res, next) => {
    siteFaviconUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        handleHomeUploadError(err, res)
        return
      }
      next()
    })
  },
  asyncRoute(async (req: AuthRequest, res) => {
    const f = req.file
    if (!f) {
      res.status(400).json({ error: 'No file uploaded (use field name "file")' })
      return
    }
    res.json({ path: `home/${f.filename}` })
  })
)

export { router as homeRouter }
