import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

function parseFormLayoutOrder(formLayout: string | null): string[] {
  try {
    const parsed = formLayout ? JSON.parse(formLayout) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

router.get('/stats', (_, res) => {
  const plans = db.prepare('SELECT id, name FROM test_plans ORDER BY name').all() as Array<{
    id: string
    name: string
  }>
  const counts = db
    .prepare(
      `SELECT test_plan_id, status, COUNT(*) as cnt
       FROM test_runs
       GROUP BY test_plan_id, status`
    )
    .all() as Array<{ test_plan_id: string; status: string; cnt: number }>

  const byPlan = new Map<
    string,
    { name: string; total: number; pass: number; fail: number; partial: number }
  >()
  for (const p of plans) {
    byPlan.set(p.id, { name: p.name, total: 0, pass: 0, fail: 0, partial: 0 })
  }
  for (const c of counts) {
    const plan = byPlan.get(c.test_plan_id)
    if (plan) {
      plan.total += c.cnt
      if (c.status === 'pass') plan.pass += c.cnt
      else if (c.status === 'fail') plan.fail += c.cnt
      else plan.partial += c.cnt
    }
  }

  res.json(
    plans.map((p) => {
      const stats = byPlan.get(p.id)!
      return {
        id: p.id,
        name: p.name,
        total: stats.total,
        pass: stats.pass,
        fail: stats.fail,
        partial: stats.partial,
      }
    })
  )
})

router.get('/', (_, res) => {
  const rows = db.prepare('SELECT * FROM test_plans ORDER BY name').all() as Array<{
    id: string
    name: string
    description: string | null
    constraints: string | null
    short_description: string | null
    field_ids: string | null
    field_layout: string | null
    form_layout: string | null
    created_at: string
  }>
  const counts = db
    .prepare(
      `SELECT test_plan_id, COUNT(*) as cnt FROM test_runs GROUP BY test_plan_id`
    )
    .all() as Array<{ test_plan_id: string; cnt: number }>
  const countByPlan = new Map(counts.map((c) => [c.test_plan_id, c.cnt]))

  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      constraints: (r as { constraints?: string | null }).constraints ?? null,
      shortDescription: (r as { short_description?: string | null }).short_description ?? null,
      fieldIds: r.field_ids ? JSON.parse(r.field_ids) : [],
      fieldLayout: r.field_layout ? JSON.parse(r.field_layout) : {},
      formLayoutOrder: parseFormLayoutOrder(r.form_layout),
      createdAt: r.created_at,
      recordCount: countByPlan.get(r.id) ?? 0,
    }))
  )
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(req.params.id) as {
    id: string
    name: string
    description: string | null
    constraints?: string | null
    short_description?: string | null
    field_ids: string | null
    field_layout: string | null
    form_layout: string | null
    created_at: string
  } | undefined
  if (!row) return res.status(404).json({ error: 'Test plan not found' })
  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    constraints: row.constraints ?? null,
    shortDescription: (row as { short_description?: string | null }).short_description ?? null,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    formLayoutOrder: parseFormLayoutOrder(row.form_layout),
    createdAt: row.created_at,
  })
})

router.post('/', requireAdmin, (req, res) => {
  const { name, description, constraints, shortDescription, fieldIds, fieldLayout, formLayoutOrder } = req.body
  if (!name) {
    return res.status(400).json({ error: 'name required' })
  }

  const id = uuidv4()
  const fieldIdsJson = Array.isArray(fieldIds) ? JSON.stringify(fieldIds) : null
  const fieldLayoutJson =
    fieldLayout && typeof fieldLayout === 'object'
      ? JSON.stringify(fieldLayout)
      : null
  const formLayoutJson =
    Array.isArray(formLayoutOrder)
      ? JSON.stringify(formLayoutOrder)
      : null
  db.prepare(
    'INSERT INTO test_plans (id, name, description, constraints, short_description, field_ids, field_layout, form_layout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, description || null, constraints || null, shortDescription || null, fieldIdsJson, fieldLayoutJson, formLayoutJson)

  const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
    id: string
    name: string
    description: string | null
    constraints?: string | null
    short_description?: string | null
    field_ids: string | null
    field_layout: string | null
    form_layout: string | null
    created_at: string
  }
  res.status(201).json({
    id: row.id,
    name: row.name,
    description: row.description,
    constraints: row.constraints ?? null,
    shortDescription: (row as { short_description?: string | null }).short_description ?? null,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    formLayoutOrder: parseFormLayoutOrder(row.form_layout),
    createdAt: row.created_at,
  })
})

router.put('/:id', requireAdmin, (req, res) => {
  const { name, description, constraints, shortDescription, fieldIds, fieldLayout, formLayoutOrder } = req.body
  const { id } = req.params

  const existing = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Test plan not found' })

  if (typeof name === 'string' && !name.trim()) {
    return res.status(400).json({ error: 'name required' })
  }

  const updates: string[] = []
  const values: unknown[] = []
  if (name !== undefined && name !== null) {
    updates.push('name = ?')
    values.push(typeof name === 'string' ? name.trim() : name)
  }
  if (description !== undefined) {
    updates.push('description = ?')
    values.push(description)
  }
  if (constraints !== undefined) {
    updates.push('constraints = ?')
    values.push(constraints)
  }
  if (shortDescription !== undefined) {
    updates.push('short_description = ?')
    values.push(typeof shortDescription === 'string' ? shortDescription.trim() || null : shortDescription)
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
  if (formLayoutOrder !== undefined) {
    updates.push('form_layout = ?')
    values.push(
      Array.isArray(formLayoutOrder)
        ? JSON.stringify(formLayoutOrder)
        : null
    )
  }
  if (updates.length === 0) {
    const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
      id: string
      name: string
      description: string | null
      constraints?: string | null
      field_ids: string | null
      field_layout: string | null
      form_layout: string | null
      created_at: string
    }
    return res.json({
      id: row.id,
      name: row.name,
      description: row.description,
      constraints: row.constraints ?? null,
      shortDescription: (row as { short_description?: string | null }).short_description ?? null,
      fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
      fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
      formLayoutOrder: parseFormLayoutOrder(row.form_layout),
      createdAt: row.created_at,
    })
  }
  values.push(id)
  db.prepare(`UPDATE test_plans SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
    id: string
    name: string
    description: string | null
    constraints?: string | null
    field_ids: string | null
    field_layout: string | null
    form_layout: string | null
    created_at: string
  }
  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    constraints: row.constraints ?? null,
    shortDescription: (row as { short_description?: string | null }).short_description ?? null,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    formLayoutOrder: parseFormLayoutOrder(row.form_layout),
    createdAt: row.created_at,
  })
})

router.delete('/:id', requireAdmin, (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Test plan not found' })
  db.prepare('DELETE FROM test_runs WHERE test_plan_id = ?').run(id)
  db.prepare('DELETE FROM test_plans WHERE id = ?').run(id)
  res.status(204).send()
})

export { router as testPlansRouter }
