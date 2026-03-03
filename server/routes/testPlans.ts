import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

router.get('/', (_, res) => {
  const rows = db.prepare('SELECT * FROM test_plans ORDER BY name').all() as Array<{
    id: string
    name: string
    description: string | null
    field_ids: string | null
    field_layout: string | null
    created_at: string
  }>
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      fieldIds: r.field_ids ? JSON.parse(r.field_ids) : [],
      fieldLayout: r.field_layout ? JSON.parse(r.field_layout) : {},
      createdAt: r.created_at,
    }))
  )
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(req.params.id) as {
    id: string
    name: string
    description: string | null
    field_ids: string | null
    field_layout: string | null
    created_at: string
  } | undefined
  if (!row) return res.status(404).json({ error: 'Test plan not found' })
  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    createdAt: row.created_at,
  })
})

router.post('/', requireAdmin, (req, res) => {
  const { name, description, fieldIds, fieldLayout } = req.body
  if (!name) {
    return res.status(400).json({ error: 'name required' })
  }

  const id = uuidv4()
  const fieldIdsJson = Array.isArray(fieldIds) ? JSON.stringify(fieldIds) : null
  const fieldLayoutJson =
    fieldLayout && typeof fieldLayout === 'object'
      ? JSON.stringify(fieldLayout)
      : null
  db.prepare(
    'INSERT INTO test_plans (id, name, description, field_ids, field_layout) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, description || null, fieldIdsJson, fieldLayoutJson)

  const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
    id: string
    name: string
    description: string | null
    field_ids: string | null
    field_layout: string | null
    created_at: string
  }
  res.status(201).json({
    id: row.id,
    name: row.name,
    description: row.description,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    createdAt: row.created_at,
  })
})

router.put('/:id', requireAdmin, (req, res) => {
  const { name, description, fieldIds, fieldLayout } = req.body
  const { id } = req.params

  const existing = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Test plan not found' })

  const updates: string[] = []
  const values: unknown[] = []
  if (name !== undefined) {
    updates.push('name = ?')
    values.push(name)
  }
  if (description !== undefined) {
    updates.push('description = ?')
    values.push(description)
  }
  if (fieldIds !== undefined) {
    updates.push('field_ids = ?')
    values.push(Array.isArray(fieldIds) ? JSON.stringify(fieldIds) : null)
  }
  if (fieldLayout !== undefined) {
    updates.push('field_layout = ?')
    values.push(
      fieldLayout && typeof fieldLayout === 'object'
        ? JSON.stringify(fieldLayout)
        : null
    )
  }
  if (updates.length === 0) {
    const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
      id: string
      name: string
      description: string | null
      field_ids: string | null
      created_at: string
    }
    return res.json({
      id: row.id,
      name: row.name,
      description: row.description,
      fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
      fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
      createdAt: row.created_at,
    })
  }
  values.push(id)
  db.prepare(`UPDATE test_plans SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
    id: string
    name: string
    description: string | null
    field_ids: string | null
    field_layout: string | null
    created_at: string
  }
  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    createdAt: row.created_at,
  })
})

router.delete('/:id', requireAdmin, (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Test plan not found' })
  const testIds = db.prepare('SELECT id FROM tests WHERE test_plan_id = ?').all(id) as { id: string }[]
  for (const t of testIds) {
    db.prepare('DELETE FROM test_runs WHERE test_id = ?').run(t.id)
  }
  db.prepare('DELETE FROM tests WHERE test_plan_id = ?').run(id)
  db.prepare('DELETE FROM test_plans WHERE id = ?').run(id)
  res.status(204).send()
})

export { router as testPlansRouter }
