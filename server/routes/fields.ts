import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

router.get('/', (_, res) => {
  const rows = db.prepare('SELECT * FROM fields ORDER BY key').all() as Array<{
    id: string
    key: string
    label: string
    type: string
    config: string | null
  }>
  res.json(
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      type: r.type,
      config: r.config ? JSON.parse(r.config) : {},
    }))
  )
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM fields WHERE id = ?').get(req.params.id) as {
    id: string
    key: string
    label: string
    type: string
    config: string | null
  } | undefined
  if (!row) return res.status(404).json({ error: 'Field not found' })
  res.json({
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    config: row.config ? JSON.parse(row.config) : {},
  })
})

router.post('/', requireAdmin, (req, res) => {
  const { key, label, type, config } = req.body
  if (!key || !label || !type) {
    return res.status(400).json({ error: 'key, label, type required' })
  }

  const existing = db.prepare('SELECT id FROM fields WHERE key = ?').get(key)
  if (existing) {
    return res.status(409).json({ error: 'Field key already exists' })
  }

  const id = uuidv4()
  db.prepare(
    'INSERT INTO fields (id, key, label, type, config) VALUES (?, ?, ?, ?, ?)'
  ).run(id, key, label, type, config ? JSON.stringify(config) : null)

  const row = db.prepare('SELECT * FROM fields WHERE id = ?').get(id) as {
    id: string
    key: string
    label: string
    type: string
    config: string | null
  }
  res.status(201).json({
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    config: row.config ? JSON.parse(row.config) : {},
  })
})

router.put('/:id', requireAdmin, (req, res) => {
  const { key, label, type, config } = req.body
  const { id } = req.params

  const existing = db.prepare('SELECT id FROM fields WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Field not found' })

  if (key) {
    const dup = db.prepare('SELECT id FROM fields WHERE key = ? AND id != ?').get(key, id)
    if (dup) return res.status(409).json({ error: 'Field key already exists' })
  }

  const updates: string[] = []
  const values: unknown[] = []
  if (key !== undefined) {
    updates.push('key = ?')
    values.push(key)
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
    const row = db.prepare('SELECT * FROM fields WHERE id = ?').get(id) as {
      id: string
      key: string
      label: string
      type: string
      config: string | null
    }
    return res.json({
      id: row.id,
      key: row.key,
      label: row.label,
      type: row.type,
      config: row.config ? JSON.parse(row.config) : {},
    })
  }
  values.push(id)
  db.prepare(`UPDATE fields SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM fields WHERE id = ?').get(id) as {
    id: string
    key: string
    label: string
    type: string
    config: string | null
  }
  res.json({
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    config: row.config ? JSON.parse(row.config) : {},
  })
})

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM fields WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Field not found' })
  res.status(204).send()
})

export { router as fieldsRouter }
