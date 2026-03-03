import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

router.get('/', (req: AuthRequest, res) => {
  const { testId, testPlanId, from, to, limit = 50 } = req.query
  let sql = `
    SELECT tr.*, t.name as test_name, t.test_plan_id,
    COALESCE(u.name, u.username) as entered_by_name
    FROM test_runs tr
    JOIN tests t ON tr.test_id = t.id
    LEFT JOIN users u ON tr.entered_by = u.id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (testId) {
    sql += ' AND tr.test_id = ?'
    params.push(testId)
  }
  if (testPlanId) {
    sql += ' AND t.test_plan_id = ?'
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
    test_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
    test_name: string
    entered_by_name: string | null
  }>

  res.json(
    rows.map((r) => ({
      id: r.id,
      testId: r.test_id,
      testName: r.test_name,
      runAt: r.run_at,
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
      `SELECT tr.*, t.name as test_name FROM test_runs tr
       JOIN tests t ON tr.test_id = t.id WHERE tr.id = ?`
    )
    .get(req.params.id) as
    | {
        id: string
        test_id: string
        run_at: string
        entered_by: string
        status: string
        data: string | null
        test_name: string
      }
    | undefined

  if (!row) return res.status(404).json({ error: 'Run not found' })

  res.json({
    id: row.id,
    testId: row.test_id,
    testName: row.test_name,
    runAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
  })
})

router.post('/', (req: AuthRequest, res) => {
  const { testId, data, status } = req.body
  if (!testId || !req.user) {
    return res.status(400).json({ error: 'testId required' })
  }

  const test = db.prepare('SELECT id FROM tests WHERE id = ?').get(testId)
  if (!test) return res.status(404).json({ error: 'Test not found' })

  const id = uuidv4()
  const runAt = new Date().toISOString()
  const statusVal = status || 'pass'

  db.prepare(
    'INSERT INTO test_runs (id, test_id, run_at, entered_by, status, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    testId,
    runAt,
    req.user.id,
    statusVal,
    data ? JSON.stringify(data) : null
  )

  const row = db
    .prepare(
      `SELECT tr.*, t.name as test_name FROM test_runs tr
       JOIN tests t ON tr.test_id = t.id WHERE tr.id = ?`
    )
    .get(id) as {
    id: string
    test_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
    test_name: string
  }

  res.status(201).json({
    id: row.id,
    testId: row.test_id,
    testName: row.test_name,
    runAt: row.run_at,
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
    test_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
  } | undefined
  if (!existing) return res.status(404).json({ error: 'Run not found' })

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
    return res.json({
      id: existing.id,
      testId: existing.test_id,
      runAt: existing.run_at,
      enteredBy: existing.entered_by,
      status: existing.status,
      data: existing.data ? JSON.parse(existing.data) : {},
    })
  }
  values.push(id)
  db.prepare(`UPDATE test_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db
    .prepare(
      `SELECT tr.*, t.name as test_name FROM test_runs tr
       JOIN tests t ON tr.test_id = t.id WHERE tr.id = ?`
    )
    .get(id) as {
    id: string
    test_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
    test_name: string
  }
  res.json({
    id: row.id,
    testId: row.test_id,
    testName: row.test_name,
    runAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
  })
})

router.delete('/:id', (req: AuthRequest, res) => {
  const result = db.prepare('DELETE FROM test_runs WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Run not found' })
  res.status(204).send()
})

export { router as runsRouter }
