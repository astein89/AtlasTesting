import { Router } from 'express'
import { db } from '../db/index.js'
import {
  PASSWORD_POLICY_KV_KEY,
  getPasswordPolicy,
  normalizePasswordPolicyBody,
} from '../lib/passwordPolicy.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'

const router = Router()

/** Public: clients show requirements next to password fields. */
router.get('/password-policy', (_req, res) => {
  res.json(getPasswordPolicy())
})

router.put(
  '/password-policy',
  authMiddleware,
  requirePermission('settings.access'),
  (req: AuthRequest, res) => {
    const normalized = normalizePasswordPolicyBody(req.body)
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error })
    }
    db.prepare('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)').run(
      PASSWORD_POLICY_KV_KEY,
      JSON.stringify(normalized.data)
    )
    res.json(normalized.data)
  }
)

export { router as settingsRouter }
