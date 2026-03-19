import { Router, type Request } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin } from '../middleware/auth.js'

const router = Router({ mergeParams: true })

router.use(authMiddleware)

type Params = { planId: string; testId?: string }

router.get('/', (req: Request<Params>, res) => {
  const planId = req.params.planId
  const plan = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(planId)
  if (!plan) return res.status(404).json({ error: 'Test plan not found' })

  const includeArchived = req.query.archived === 'true'
  const rows = db
    .prepare(
      `SELECT t.id, t.test_plan_id, t.name, t.start_date, t.end_date, t.archived, t.created_at, t.updated_at,
       (SELECT COUNT(*) FROM test_runs tr WHERE tr.test_id = t.id) as record_count
       FROM tests t
       WHERE t.test_plan_id = ?
       ${includeArchived ? '' : 'AND t.archived = 0'}
       ORDER BY t.created_at ASC`
    )
    .all(planId) as Array<{
    id: string
    test_plan_id: string
    name: string
    start_date: string | null
    end_date: string | null
    archived: number
    created_at: string
    updated_at: string | null
    record_count: number
  }>

  res.json(
    rows.map((r) => ({
      id: r.id,
      testPlanId: r.test_plan_id,
      name: r.name,
      startDate: r.start_date ?? undefined,
      endDate: r.end_date ?? undefined,
      archived: Boolean(r.archived),
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? undefined,
      recordCount: r.record_count,
    }))
  )
})

router.post('/', (req: Request<Params>, res) => {
  const planId = req.params.planId
  const { name, startDate, endDate } = req.body
  const plan = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(planId)
  if (!plan) return res.status(404).json({ error: 'Test plan not found' })
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' })
  }

  const id = uuidv4()
  const startDateVal = typeof startDate === 'string' && startDate.trim() ? startDate.trim() : null
  const endDateVal = typeof endDate === 'string' && endDate.trim() ? endDate.trim() : null
  db.prepare(
    'INSERT INTO tests (id, test_plan_id, name, start_date, end_date, archived) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(id, planId, name.trim(), startDateVal, endDateVal)

  const row = db.prepare('SELECT * FROM tests WHERE id = ?').get(id) as {
    id: string
    test_plan_id: string
    name: string
    start_date: string | null
    end_date: string | null
    archived: number
    created_at: string
  }
  res.status(201).json({
    id: row.id,
    testPlanId: row.test_plan_id,
    name: row.name,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    archived: false,
    createdAt: row.created_at,
    recordCount: 0,
  })
})

router.get('/:testId', (req: Request<Params>, res) => {
  const planId = req.params.planId
  const testId = req.params.testId
  const plan = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(planId)
  if (!plan) return res.status(404).json({ error: 'Test plan not found' })
  const row = db
    .prepare(
      `SELECT t.id, t.test_plan_id, t.name, t.start_date, t.end_date, t.archived, t.created_at, t.updated_at,
       (SELECT COUNT(*) FROM test_runs tr WHERE tr.test_id = t.id) as record_count
       FROM tests t
       WHERE t.id = ? AND t.test_plan_id = ?`
    )
    .get(testId, planId) as {
    id: string
    test_plan_id: string
    name: string
    start_date: string | null
    end_date: string | null
    archived: number
    created_at: string
    updated_at: string | null
    record_count: number
  } | undefined
  if (!row) return res.status(404).json({ error: 'Test not found' })
  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    name: row.name,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    recordCount: row.record_count ?? 0,
  })
})

router.put('/:testId', requireAdmin, (req: Request<Params>, res) => {
  const planId = req.params.planId
  const testId = req.params.testId
  const { name, startDate, endDate, archived } = req.body

  const test = db.prepare('SELECT * FROM tests WHERE id = ? AND test_plan_id = ?').get(testId, planId) as {
    id: string
    name: string
    start_date: string | null
    end_date: string | null
    archived: number
    created_at: string
  } | undefined
  if (!test) return res.status(404).json({ error: 'Test not found' })

  const updates: string[] = []
  const values: unknown[] = []
  if (name !== undefined && typeof name === 'string') {
    updates.push('name = ?')
    values.push(name.trim() || test.name)
  }
  if (startDate !== undefined) {
    updates.push('start_date = ?')
    values.push(typeof startDate === 'string' && startDate.trim() ? startDate.trim() : null)
  }
  if (endDate !== undefined) {
    updates.push('end_date = ?')
    values.push(typeof endDate === 'string' && endDate.trim() ? endDate.trim() : null)
  }
  if (typeof archived === 'boolean') {
    updates.push('archived = ?')
    values.push(archived ? 1 : 0)
  }
  const testRow = test as { created_at: string; updated_at?: string | null }
  if (updates.length === 0) {
    const count = db.prepare('SELECT COUNT(*) as c FROM test_runs WHERE test_id = ?').get(testId) as { c: number }
    return res.json({
      id: testId,
      testPlanId: planId,
      name: test.name,
      startDate: test.start_date ?? undefined,
      endDate: test.end_date ?? undefined,
      archived: Boolean(test.archived),
      createdAt: testRow.created_at,
      updatedAt: testRow.updated_at ?? undefined,
      recordCount: count?.c ?? 0,
    })
  }
  updates.push('updated_at = datetime(\'now\')')
  values.push(testId)
  db.prepare(`UPDATE tests SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM tests WHERE id = ?').get(testId) as {
    id: string
    test_plan_id: string
    name: string
    start_date: string | null
    end_date: string | null
    archived: number
    created_at: string
    updated_at: string | null
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM test_runs WHERE test_id = ?').get(testId) as { c: number }
  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    name: row.name,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    recordCount: count?.c ?? 0,
  })
})

router.delete('/:testId', requireAdmin, (req: Request<Params>, res) => {
  const planId = req.params.planId
  const testId = req.params.testId
  const test = db.prepare('SELECT id FROM tests WHERE id = ? AND test_plan_id = ?').get(testId, planId)
  if (!test) return res.status(404).json({ error: 'Test not found' })
  db.prepare('DELETE FROM test_runs WHERE test_id = ?').run(testId)
  db.prepare('DELETE FROM tests WHERE id = ?').run(testId)
  res.status(204).send()
})

export { router as testsRouter }
