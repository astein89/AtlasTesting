import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

router.get('/', (req: AuthRequest, res) => {
  const { testPlanId, from, to, limit = 50 } = req.query
  let sql = `
    SELECT tr.*, tp.name as plan_name,
    COALESCE(u.name, u.username) as entered_by_name
    FROM test_runs tr
    JOIN test_plans tp ON tr.test_plan_id = tp.id
    LEFT JOIN users u ON tr.entered_by = u.id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (testPlanId) {
    sql += ' AND tr.test_plan_id = ?'
    params.push(testPlanId)
  }
  if (from) {
    sql += ' AND tr.run_at >= ?'
    params.push(from)
  }
  if (to) {
    sql += ' AND tr.run_at <= ?'
    params.push(to)
  }
  sql += ' ORDER BY tr.run_at DESC LIMIT ?'
  params.push(Math.min(parseInt(limit as string) || 50, 10000))

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string
    test_plan_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
    plan_name: string
    entered_by_name: string | null
  }>

  res.json(
    rows.map((r) => ({
      id: r.id,
      testPlanId: r.test_plan_id,
      planName: r.plan_name,
      recordedAt: r.run_at,
      enteredBy: r.entered_by,
      enteredByName: r.entered_by_name || r.entered_by,
      status: r.status,
      data: r.data ? JSON.parse(r.data) : {},
    }))
  )
})

router.get('/:id', (req: AuthRequest, res) => {
  const row = db
    .prepare(
      `SELECT tr.*, tp.name as plan_name FROM test_runs tr
       JOIN test_plans tp ON tr.test_plan_id = tp.id WHERE tr.id = ?`
    )
    .get(req.params.id) as
    | {
        id: string
        test_plan_id: string
        run_at: string
        entered_by: string
        status: string
        data: string | null
        plan_name: string
      }
    | undefined

  if (!row) return res.status(404).json({ error: 'Record not found' })

  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    planName: row.plan_name,
    recordedAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
  })
})

router.post('/', (req: AuthRequest, res) => {
  const { testPlanId, data, status } = req.body
  if (!testPlanId || !req.user) {
    return res.status(400).json({ error: 'testPlanId required' })
  }
  if (!status || !['pass', 'fail', 'partial'].includes(status)) {
    return res.status(400).json({ error: 'status required (pass, fail, or partial)' })
  }

  const plan = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(testPlanId)
  if (!plan) return res.status(404).json({ error: 'Test plan not found' })

  const id = uuidv4()
  const recordedAt = new Date().toISOString()

  db.prepare(
    'INSERT INTO test_runs (id, test_plan_id, run_at, entered_by, status, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    testPlanId,
    recordedAt,
    req.user.id,
    status,
    data ? JSON.stringify(data) : null
  )

  const row = db
    .prepare(
      `SELECT tr.*, tp.name as plan_name FROM test_runs tr
       JOIN test_plans tp ON tr.test_plan_id = tp.id WHERE tr.id = ?`
    )
    .get(id) as {
    id: string
    test_plan_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
    plan_name: string
  }

  res.status(201).json({
    id: row.id,
    testPlanId: row.test_plan_id,
    planName: row.plan_name,
    recordedAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
  })
})

router.put('/:id', (req: AuthRequest, res) => {
  const { id } = req.params
  const { data, status } = req.body

  const existing = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as {
    id: string
    test_plan_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
  } | undefined
  if (!existing) return res.status(404).json({ error: 'Record not found' })

  const updates: string[] = []
  const values: unknown[] = []
  if (data !== undefined) {
    updates.push('data = ?')
    values.push(JSON.stringify(data))
  }
  if (status !== undefined) {
    updates.push('status = ?')
    values.push(status)
  }
  if (updates.length === 0) {
    const planRow = db.prepare('SELECT name FROM test_plans WHERE id = ?').get(existing.test_plan_id) as { name: string }
    return res.json({
      id: existing.id,
      testPlanId: existing.test_plan_id,
      planName: planRow?.name || '',
      recordedAt: existing.run_at,
      enteredBy: existing.entered_by,
      status: existing.status,
      data: existing.data ? JSON.parse(existing.data) : {},
    })
  }
  values.push(id)
  db.prepare(`UPDATE test_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db
    .prepare(
      `SELECT tr.*, tp.name as plan_name FROM test_runs tr
       JOIN test_plans tp ON tr.test_plan_id = tp.id WHERE tr.id = ?`
    )
    .get(id) as {
    id: string
    test_plan_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
    plan_name: string
  }
  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    planName: row.plan_name,
    recordedAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
  })
})

router.delete('/:id', (req: AuthRequest, res) => {
  const result = db.prepare('DELETE FROM test_runs WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Record not found' })
  res.status(204).send()
})

export { router as recordsRouter }
