import { Router } from 'express'
import { db } from '../db/index.js'
import {
  PASSWORD_POLICY_KV_KEY,
  getPasswordPolicy,
  normalizePasswordPolicyBody,
} from '../lib/passwordPolicy.js'
import {
  getFilesRecycleRetentionDays,
  normalizeFilesRecycleRetentionDaysBody,
  setFilesRecycleRetentionDays,
} from '../lib/filesRecycleSettings.js'
import {
  getWikiRecycleRetentionDays,
  normalizeWikiRecycleRetentionDaysBody,
  setWikiRecycleRetentionDays,
} from '../lib/wikiRecycleSettings.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()

/** Public: clients show requirements next to password fields. */
router.get(
  '/password-policy',
  asyncRoute(async (_req, res) => {
    res.json(await getPasswordPolicy())
  })
)

router.put(
  '/password-policy',
  authMiddleware,
  requirePermission('settings.access'),
  asyncRoute(async (req: AuthRequest, res) => {
    const normalized = normalizePasswordPolicyBody(req.body)
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error })
    }
    await db
      .prepare(
        `INSERT INTO app_kv (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      )
      .run(PASSWORD_POLICY_KV_KEY, JSON.stringify(normalized.data))
    res.json(normalized.data)
  })
)

router.get(
  '/files-recycle',
  authMiddleware,
  requirePermission('settings.access'),
  asyncRoute(async (_req: AuthRequest, res) => {
    const retentionDays = await getFilesRecycleRetentionDays()
    res.json({ retentionDays })
  })
)

router.put(
  '/files-recycle',
  authMiddleware,
  requirePermission('settings.access'),
  asyncRoute(async (req: AuthRequest, res) => {
    const normalized = normalizeFilesRecycleRetentionDaysBody(req.body)
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error })
    }
    await setFilesRecycleRetentionDays(normalized.days)
    res.json({ retentionDays: normalized.days })
  })
)

router.get(
  '/wiki-recycle',
  authMiddleware,
  requirePermission('settings.access'),
  asyncRoute(async (_req: AuthRequest, res) => {
    const retentionDays = await getWikiRecycleRetentionDays()
    res.json({ retentionDays })
  })
)

router.put(
  '/wiki-recycle',
  authMiddleware,
  requirePermission('settings.access'),
  asyncRoute(async (req: AuthRequest, res) => {
    const normalized = normalizeWikiRecycleRetentionDaysBody(req.body)
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error })
    }
    await setWikiRecycleRetentionDays(normalized.days)
    res.json({ retentionDays: normalized.days })
  })
)

export { router as settingsRouter }
