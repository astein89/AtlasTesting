import { randomUUID } from 'node:crypto'
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
}

const DEFAULT_HOME: HomePagePayload = {
  introMarkdown: 'Choose a module to continue.',
  customLinks: [],
}

const MAX_LINKS = 40
const MAX_INTRO_MARKDOWN = 50_000
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

function parseStored(raw: string | undefined): HomePagePayload {
  if (!raw) return { ...DEFAULT_HOME }
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
    if (introMarkdown.trim() === '') introMarkdown = DEFAULT_HOME.introMarkdown
    return {
      introMarkdown,
      customLinks: Array.isArray(j.customLinks) ? j.customLinks : [],
    }
  } catch {
    return { ...DEFAULT_HOME }
  }
}

function normalizePayload(body: unknown): { ok: true; data: HomePagePayload } | { ok: false; error: string } {
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
  return { ok: true, data: { introMarkdown, customLinks } }
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
  const parsed = parseStored(row?.value)
  res.json(parsed)
})

router.put('/', authMiddleware, requirePermission('home.edit'), (req: AuthRequest, res) => {
  const normalized = normalizePayload(req.body)
  if (!normalized.ok) {
    return res.status(400).json({ error: normalized.error })
  }
  db.prepare('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)').run(
    HOME_KEY,
    JSON.stringify(normalized.data)
  )
  res.json(normalized.data)
})

export { router as homeRouter }
