import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

router.get('/', (req, res) => {
  const { testPlanId } = req.query
  let sql = 'SELECT * FROM tests'
  const params: unknown[] = []
  if (testPlanId) {
    sql += ' WHERE test_plan_id = ?'
    params.push(testPlanId)
  }
  sql += ' ORDER BY name'
  const rows = db.prepare(sql).all(...params) as Array<{
    id: string
    test_plan_id: string
    name: string
    description: string | null
    field_ids: string
  }>
  res.json(
    rows.map((r) => ({
      id: r.id,
      testPlanId: r.test_plan_id,
      name: r.name,
      description: r.description,
      fieldIds: JSON.parse(r.field_ids),
    }))
  )
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tests WHERE id = ?').get(req.params.id) as {
    id: string
    test_plan_id: string
    name: string
    description: string | null
    field_ids: string
  } | undefined
  if (!row) return res.status(404).json({ error: 'Test not found' })
  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    name: row.name,
    description: row.description,
    fieldIds: JSON.parse(row.field_ids),
  })
})

router.post('/', requireAdmin, (req, res) => {
  const { testPlanId, name, description, fieldIds } = req.body
  if (!testPlanId || !name || !Array.isArray(fieldIds)) {
    return res.status(400).json({ error: 'testPlanId, name and fieldIds required' })
  }

  const plan = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(testPlanId)
  if (!plan) return res.status(404).json({ error: 'Test plan not found' })

  const id = uuidv4()
  db.prepare(
    'INSERT INTO tests (id, test_plan_id, name, description, field_ids) VALUES (?, ?, ?, ?, ?)'
  ).run(id, testPlanId, name, description || null, JSON.stringify(fieldIds))

  const row = db.prepare('SELECT * FROM tests WHERE id = ?').get(id) as {
    id: string
    test_plan_id: string
    name: string
    description: string | null
    field_ids: string
  }
  res.status(201).json({
    id: row.id,
    testPlanId: row.test_plan_id,
    name: row.name,
    description: row.description,
    fieldIds: JSON.parse(row.field_ids),
  })
})

router.put('/:id', requireAdmin, (req, res) => {
  const { testPlanId, name, description, fieldIds } = req.body
  const { id } = req.params

  const existing = db.prepare('SELECT id FROM tests WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Test not found' })

  const updates: string[] = []
  const values: unknown[] = []
  if (testPlanId !== undefined) {
    updates.push('test_plan_id = ?')
    values.push(testPlanId)
  }
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
    values.push(JSON.stringify(fieldIds))
  }
  if (updates.length === 0) {
    const row = db.prepare('SELECT * FROM tests WHERE id = ?').get(id) as {
      id: string
      test_plan_id: string
      name: string
      description: string | null
      field_ids: string
    }
    return res.json({
      id: row.id,
      testPlanId: row.test_plan_id,
      name: row.name,
      description: row.description,
      fieldIds: JSON.parse(row.field_ids),
    })
  }
  values.push(id)
  db.prepare(`UPDATE tests SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM tests WHERE id = ?').get(id) as {
    id: string
    test_plan_id: string
    name: string
    description: string | null
    field_ids: string
  }
  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    name: row.name,
    description: row.description,
    fieldIds: JSON.parse(row.field_ids),
  })
})

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM tests WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Test not found' })
  res.status(204).send()
})

export { router as testsRouter }
