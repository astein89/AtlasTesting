import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { db } from '../db/index.js'
import {
  authMiddleware,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.js'
import { isValidLinkRequiredPermission } from '../lib/permissionsCatalog.js'
import { roleSlugExists } from '../lib/userRoles.js'

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
}

export interface HomePagePayload {
  introMarkdown: string
  customLinks: HomeCustomLink[]
  /** Display order for home module cards; full list of known module ids. */
  moduleOrder: string[]
  showWelcomeLogo?: boolean
  welcomeLogoMaxRem?: number
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
const HOME_MODULE_IDS: string[] = ['testing', 'locations', 'wiki', 'admin']
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

const DEFAULT_KV_HOME = {
  introMarkdown: readDefaultIntroFromRepoFile(),
  showWelcomeLogo: false,
  welcomeLogoMaxRem: WELCOME_LOGO_DEFAULT_REM,
  moduleOrder: [...HOME_MODULE_IDS],
}

const DEFAULT_HOME: HomePagePayload = {
  introMarkdown: DEFAULT_KV_HOME.introMarkdown,
  customLinks: [],
  moduleOrder: [...HOME_MODULE_IDS],
  showWelcomeLogo: DEFAULT_KV_HOME.showWelcomeLogo,
  welcomeLogoMaxRem: DEFAULT_KV_HOME.welcomeLogoMaxRem,
}
const MAX_LINK_TITLE = 120
const MAX_LINK_DESC = 400
const MAX_HREF = 2000
const MAX_ROLE_SLUGS_PER_LINK = 32

function isValidHref(href: string): boolean {
  const t = href.trim()
  if (!t || t.length > MAX_HREF) return false
  if (/^https?:\/\//i.test(t)) return true
  if (t.startsWith('mailto:')) return true
  if (t.startsWith('/')) return !t.includes('//')
  return false
}

/** Home intro, logo, module order (custom links live in `home_links`). */
function parseHomeKv(raw: string | undefined): Omit<HomePagePayload, 'customLinks'> {
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
    return {
      introMarkdown,
      showWelcomeLogo,
      welcomeLogoMaxRem,
      moduleOrder,
    }
  } catch {
    return { ...DEFAULT_KV_HOME }
  }
}

function loadCustomLinksFromDb(): HomeCustomLink[] {
  const rows = db
    .prepare(
      `SELECT id, title, description, href, allowed_role_slugs, required_permission, sort_order
       FROM home_links ORDER BY sort_order ASC, id ASC`
    )
    .all() as Array<{
    id: string
    title: string
    description: string
    href: string
    allowed_role_slugs: string | null
    required_permission: string | null
    sort_order: number
  }>
  const out: HomeCustomLink[] = []
  for (const r of rows) {
    const base: HomeCustomLink = {
      id: r.id,
      title: r.title,
      description: r.description ?? '',
      href: r.href,
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

function replaceLinksInDb(links: HomeCustomLink[]) {
  db.prepare('DELETE FROM home_links').run()
  const ins = db.prepare(`
    INSERT INTO home_links (id, title, description, href, allowed_role_slugs, required_permission, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  let sortOrder = 0
  for (const link of links) {
    ins.run(
      link.id,
      link.title,
      link.description,
      link.href,
      link.allowedRoleSlugs?.length ? JSON.stringify(link.allowedRoleSlugs) : null,
      link.requiredPermission ?? null,
      sortOrder
    )
    sortOrder += 1
  }
}

function normalizePayload(
  body: unknown,
  moduleOrderFallback: string[]
): { ok: true; data: HomePagePayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }
  const b = body as Record<string, unknown>
  let introMarkdown = ''
  if (typeof b.introMarkdown === 'string') {
    introMarkdown = b.introMarkdown.trim().slice(0, MAX_INTRO_MARKDOWN)
  } else if (typeof b.introSubtitle === 'string') {
    introMarkdown = b.introSubtitle.trim().slice(0, MAX_INTRO_MARKDOWN)
  }
  if (introMarkdown === '' && typeof b.introTitle === 'string' && b.introTitle.trim()) {
    introMarkdown = `# ${b.introTitle.trim().slice(0, 200)}`
  }
  if (introMarkdown === '') introMarkdown = DEFAULT_HOME.introMarkdown
  const rawLinks = b.customLinks
  if (!Array.isArray(rawLinks)) return { ok: false, error: 'customLinks must be an array' }
  const customLinks: HomeCustomLink[] = []
  for (const item of rawLinks.slice(0, MAX_LINKS)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 80) : randomUUID()
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, MAX_LINK_TITLE) : ''
    const description = typeof o.description === 'string' ? o.description.trim().slice(0, MAX_LINK_DESC) : ''
    const href = typeof o.href === 'string' ? o.href.trim() : ''
    if (!title || !href) continue
    if (!isValidHref(href)) return { ok: false, error: `Invalid href for link "${title}"` }

    let allowedRoleSlugs: string[] | undefined
    if (o.allowedRoleSlugs !== undefined && o.allowedRoleSlugs !== null) {
      if (!Array.isArray(o.allowedRoleSlugs)) {
        return { ok: false, error: `allowedRoleSlugs must be an array for link "${title}"` }
      }
      const raw = o.allowedRoleSlugs
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_ROLE_SLUGS_PER_LINK)
      const uniq = [...new Set(raw)].sort()
      for (const s of uniq) {
        if (!roleSlugExists(db, s)) {
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

    const base = { id, title, description, href }
    if (allowedRoleSlugs?.length) {
      customLinks.push({ ...base, allowedRoleSlugs })
    } else if (requiredPermission) {
      customLinks.push({ ...base, requiredPermission })
    } else {
      customLinks.push(base)
    }
  }
  const showWelcomeLogo = coerceHomeBool(b.showWelcomeLogo)
  const welcomeLogoMaxRem = coerceWelcomeLogoMaxRem(b.welcomeLogoMaxRem)

  let moduleOrder: string[]
  if (b.moduleOrder !== undefined && b.moduleOrder !== null) {
    if (!Array.isArray(b.moduleOrder)) {
      return { ok: false, error: 'moduleOrder must be an array' }
    }
    moduleOrder = normalizeModuleOrder(b.moduleOrder)
  } else {
    moduleOrder = normalizeModuleOrder(moduleOrderFallback)
  }

  return { ok: true, data: { introMarkdown, customLinks, showWelcomeLogo, welcomeLogoMaxRem, moduleOrder } }
}

/** Slug/label pairs for home link visibility (editors may not have users.manage). */
router.get('/role-options', authMiddleware, requirePermission('home.edit'), (_req: AuthRequest, res) => {
  try {
    const rows = db.prepare('SELECT slug, label FROM roles ORDER BY slug').all() as Array<{
      slug: string
      label: string
    }>
    res.json(rows)
  } catch {
    res.status(500).json({ error: 'Failed to load roles' })
  }
})

/** Public read: home hub is shown before login. Mutations remain `home.edit`. */
router.get('/', (_req, res) => {
  const row = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(HOME_KEY) as { value: string } | undefined
  const kv = parseHomeKv(row?.value)
  res.json({
    introMarkdown: kv.introMarkdown,
    customLinks: loadCustomLinksFromDb(),
    moduleOrder: kv.moduleOrder,
    showWelcomeLogo: kv.showWelcomeLogo,
    welcomeLogoMaxRem: kv.welcomeLogoMaxRem,
  })
})

router.put('/', authMiddleware, requirePermission('home.edit'), (req: AuthRequest, res) => {
  const row = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(HOME_KEY) as { value: string } | undefined
  const prevOrder = parseHomeKv(row?.value).moduleOrder
  const normalized = normalizePayload(req.body, prevOrder)
  if (!normalized.ok) {
    return res.status(400).json({ error: normalized.error })
  }
  const kvOnly = {
    introMarkdown: normalized.data.introMarkdown,
    showWelcomeLogo: normalized.data.showWelcomeLogo === true,
    welcomeLogoMaxRem: normalized.data.welcomeLogoMaxRem,
    moduleOrder: normalized.data.moduleOrder,
  }
  db.prepare('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)').run(
    HOME_KEY,
    JSON.stringify(kvOnly)
  )
  replaceLinksInDb(normalized.data.customLinks)
  res.json({
    introMarkdown: kvOnly.introMarkdown,
    customLinks: normalized.data.customLinks,
    moduleOrder: kvOnly.moduleOrder,
    showWelcomeLogo: kvOnly.showWelcomeLogo,
    welcomeLogoMaxRem: kvOnly.welcomeLogoMaxRem,
  })
})

export { router as homeRouter }
