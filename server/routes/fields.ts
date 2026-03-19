import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

function toFieldJson(r: {
  id: string
  key: string
  label: string
  type: string
  config: string | null
  created_at?: string | null
  updated_at?: string | null
  created_by?: string | null
  updated_by?: string | null
  created_by_name?: string | null
  updated_by_name?: string | null
}) {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type,
    config: r.config ? JSON.parse(r.config) : {},
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
    createdBy: r.created_by ?? null,
    updatedBy: r.updated_by ?? null,
    createdByName: r.created_by_name ?? null,
    updatedByName: r.updated_by_name ?? null,
  }
}

router.get('/', (_, res) => {
  const rows = db
    .prepare(
      `SELECT f.*,
        COALESCE(uc.name, uc.username) as created_by_name,
        COALESCE(uu.name, uu.username) as updated_by_name
       FROM fields f
       LEFT JOIN users uc ON f.created_by = uc.id
       LEFT JOIN users uu ON f.updated_by = uu.id
       ORDER BY f.key`
    )
    .all() as Array<{
    id: string
    key: string
    label: string
    type: string
    config: string | null
    created_at?: string | null
    updated_at?: string | null
    created_by?: string | null
    updated_by?: string | null
    created_by_name?: string | null
    updated_by_name?: string | null
  }>
  res.json(rows.map(toFieldJson))
})

router.get('/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT f.*,
        COALESCE(uc.name, uc.username) as created_by_name,
        COALESCE(uu.name, uu.username) as updated_by_name
       FROM fields f
       LEFT JOIN users uc ON f.created_by = uc.id
       LEFT JOIN users uu ON f.updated_by = uu.id
       WHERE f.id = ?`
    )
    .get(req.params.id) as {
    id: string
    key: string
    label: string
    type: string
    config: string | null
    created_at?: string | null
    updated_at?: string | null
    created_by?: string | null
    updated_by?: string | null
    created_by_name?: string | null
    updated_by_name?: string | null
  } | undefined
  if (!row) return res.status(404).json({ error: 'Field not found' })
  res.json(toFieldJson(row))
})

router.post('/', requireAdmin, (req: AuthRequest, res) => {
  const { key, label, type, config } = req.body
  if (!key || !label || !type) {
    return res.status(400).json({ error: 'key, label, type required' })
  }

  const existing = db.prepare('SELECT id FROM fields WHERE key = ?').get(key)
  if (existing) {
    return res.status(409).json({ error: 'Field key already exists' })
  }

  const id = uuidv4()
  const createdBy = req.user?.id ?? null
  db.prepare(
    'INSERT INTO fields (id, key, label, type, config, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, key, label, type, config ? JSON.stringify(config) : null, createdBy)

  const row = db
    .prepare(
      `SELECT f.*, COALESCE(uc.name, uc.username) as created_by_name, COALESCE(uu.name, uu.username) as updated_by_name
       FROM fields f
       LEFT JOIN users uc ON f.created_by = uc.id
       LEFT JOIN users uu ON f.updated_by = uu.id
       WHERE f.id = ?`
    )
    .get(id) as Parameters<typeof toFieldJson>[0]
  res.status(201).json(toFieldJson(row))
})

router.put('/:id', requireAdmin, (req: AuthRequest, res) => {
  const { key: newKey, label, type, config } = req.body
  const { id } = req.params

  const existing = db.prepare('SELECT id, key FROM fields WHERE id = ?').get(id) as
    | { id: string; key: string }
    | undefined
  if (!existing) return res.status(404).json({ error: 'Field not found' })

  const oldKey = (existing.key ?? '').trim()
  const newKeyTrimmed = typeof newKey === 'string' ? newKey.trim() : undefined

  if (newKeyTrimmed) {
    const dup = db.prepare('SELECT id FROM fields WHERE key = ? AND id != ?').get(newKeyTrimmed, id)
    if (dup) return res.status(409).json({ error: 'Field key already exists' })
  }

  // When key is being changed: migrate record data and plan field_defaults/key_field so stored data is preserved
  if (newKeyTrimmed !== undefined && newKeyTrimmed !== '' && newKeyTrimmed !== oldKey) {
    const runs = db.prepare('SELECT id, data FROM test_runs WHERE data IS NOT NULL').all() as Array<{
      id: string
      data: string | null
    }>
    const updateStmt = db.prepare('UPDATE test_runs SET data = ? WHERE id = ?')
    for (const row of runs) {
      if (!row.data || typeof row.data !== 'string') continue
      try {
        const data = JSON.parse(row.data) as Record<string, unknown>
        if (!Object.prototype.hasOwnProperty.call(data, oldKey)) continue
        const newData: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(data)) {
          if (k === oldKey) newData[newKeyTrimmed] = v
          else newData[k] = v
        }
        updateStmt.run(JSON.stringify(newData), row.id)
      } catch {
        // Skip malformed data
      }
    }
    const plans = db.prepare('SELECT id, field_defaults, key_field FROM test_plans').all() as Array<{
      id: string
      field_defaults: string | null
      key_field: string | null
    }>
    for (const plan of plans) {
      let updateDefaults: string | null = null
      if (plan.field_defaults) {
        try {
          const defaults = JSON.parse(plan.field_defaults) as Record<string, unknown>
          if (Object.prototype.hasOwnProperty.call(defaults, oldKey)) {
            defaults[newKeyTrimmed] = defaults[oldKey]
            delete defaults[oldKey]
            updateDefaults = JSON.stringify(defaults)
          }
        } catch {
          // Skip malformed JSON
        }
      }
      const planKeyFieldNew = plan.key_field === oldKey ? newKeyTrimmed : plan.key_field
      const keyFieldChanged = plan.key_field === oldKey
      if (updateDefaults !== null || keyFieldChanged) {
        if (updateDefaults !== null && keyFieldChanged) {
          db.prepare('UPDATE test_plans SET field_defaults = ?, key_field = ? WHERE id = ?').run(
            updateDefaults,
            planKeyFieldNew,
            plan.id
          )
        } else if (updateDefaults !== null) {
          db.prepare('UPDATE test_plans SET field_defaults = ? WHERE id = ?').run(updateDefaults, plan.id)
        } else {
          db.prepare('UPDATE test_plans SET key_field = ? WHERE id = ?').run(planKeyFieldNew, plan.id)
        }
      }
    }
  }

  const updates: string[] = []
  const values: unknown[] = []
  if (newKey !== undefined) {
    updates.push('key = ?')
    values.push(newKeyTrimmed ?? newKey)
  }
  if (label !== undefined) {
    updates.push('label = ?')
    values.push(label)
  }
  if (type !== undefined) {
    updates.push('type = ?')
    values.push(type)
  }
  if (config !== undefined) {
    updates.push('config = ?')
    values.push(JSON.stringify(config))
  }
  if (updates.length === 0) {
    const row = db
      .prepare(
        `SELECT f.*, uc.username as created_by_name, uu.username as updated_by_name
         FROM fields f
         LEFT JOIN users uc ON f.created_by = uc.id
         LEFT JOIN users uu ON f.updated_by = uu.id
         WHERE f.id = ?`
      )
      .get(id) as Parameters<typeof toFieldJson>[0]
    return res.json(toFieldJson(row))
  }
  updates.push('updated_at = ?', 'updated_by = ?')
  values.push(new Date().toISOString(), req.user?.id ?? null, id)
  db.prepare(`UPDATE fields SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db
    .prepare(
      `SELECT f.*, COALESCE(uc.name, uc.username) as created_by_name, COALESCE(uu.name, uu.username) as updated_by_name
       FROM fields f
       LEFT JOIN users uc ON f.created_by = uc.id
       LEFT JOIN users uu ON f.updated_by = uu.id
       WHERE f.id = ?`
    )
    .get(id) as Parameters<typeof toFieldJson>[0]
  res.json(toFieldJson(row))
})

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM fields WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Field not found' })
  res.status(204).send()
})

export { router as fieldsRouter }
