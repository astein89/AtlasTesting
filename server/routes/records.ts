import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin, requireCanEditData, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

function insertRecordHistory(
  recordId: string,
  action: 'created' | 'updated' | 'deleted',
  oldData: string | null,
  oldStatus: string | null,
  newData: string | null,
  newStatus: string | null,
  userId: string
) {
  const id = uuidv4()
  const changedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO record_history (id, record_id, changed_at, changed_by, action, old_data, old_status, new_data, new_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, recordId, changedAt, userId, action, oldData, oldStatus, newData, newStatus)
}

router.get('/', (req: AuthRequest, res) => {
  const { testPlanId, testId, from, to, limit = 50 } = req.query
  let sql = `
    SELECT tr.*,
    tp.name as plan_name,
    COALESCE(u.name, u.username) as entered_by_name,
    t.name as test_name,
    (
      SELECT MAX(rh.changed_at)
      FROM record_history rh
      WHERE rh.record_id = tr.id
    ) as last_edited_at
    FROM test_runs tr
    JOIN test_plans tp ON tr.test_plan_id = tp.id
    LEFT JOIN users u ON tr.entered_by = u.id
    LEFT JOIN tests t ON tr.test_id = t.id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (testPlanId) {
    sql += ' AND tr.test_plan_id = ?'
    params.push(testPlanId)
  }
  if (testId) {
    sql += ' AND tr.test_id = ?'
    params.push(testId)
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
    last_edited_at: string | null
    run_id?: string | null
    test_id?: string | null
    test_name?: string | null
  }>

  res.json(
    rows.map((r) => ({
      id: r.id,
      testPlanId: r.test_plan_id,
      testId: r.test_id ?? undefined,
      testName: r.test_name ?? undefined,
      planName: r.plan_name,
      recordedAt: r.run_at,
      enteredBy: r.entered_by,
      enteredByName: r.entered_by_name || r.entered_by,
      lastEditedAt: r.last_edited_at ?? r.run_at,
      status: r.status,
      data: r.data ? JSON.parse(r.data) : {},
      runId: r.run_id ?? undefined,
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

  const rowWithRunId = row as { run_id?: string | null; test_id?: string | null }
  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    testId: rowWithRunId.test_id ?? undefined,
    planName: row.plan_name,
    recordedAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
    runId: rowWithRunId.run_id ?? undefined,
  })
})

router.get('/:id/history', requireAdmin, (req: AuthRequest, res) => {
  const { id } = req.params
  const record = db.prepare('SELECT id FROM test_runs WHERE id = ?').get(id)
  if (!record) return res.status(404).json({ error: 'Record not found' })

  const rows = db
    .prepare(
      `SELECT rh.id, rh.record_id, rh.changed_at, rh.changed_by, rh.action, rh.old_data, rh.old_status, rh.new_data, rh.new_status,
       COALESCE(u.name, u.username) as changed_by_name
       FROM record_history rh
       LEFT JOIN users u ON rh.changed_by = u.id
       WHERE rh.record_id = ?
       ORDER BY rh.changed_at DESC`
    )
    .all(id) as Array<{
    changed_at: string
    changed_by: string
    changed_by_name: string | null
    action: string
    old_data: string | null
    old_status: string | null
    new_data: string | null
    new_status: string | null
  }>

  const entries = rows.map((r) => {
    const changes: Array<{ field: string; oldVal: unknown; newVal: unknown }> = []
    if (r.action === 'updated') {
      if (r.old_status !== r.new_status) {
        changes.push({ field: 'status', oldVal: r.old_status ?? undefined, newVal: r.new_status ?? undefined })
      }
      const oldData = r.old_data ? (JSON.parse(r.old_data) as Record<string, unknown>) : {}
      const newData = r.new_data ? (JSON.parse(r.new_data) as Record<string, unknown>) : {}
      const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)])
      for (const key of allKeys) {
        const ov = oldData[key]
        const nv = newData[key]
        if (JSON.stringify(ov) !== JSON.stringify(nv)) {
          changes.push({ field: key, oldVal: ov, newVal: nv })
        }
      }
    } else if (r.action === 'created' && r.new_status != null) {
      changes.push({ field: 'status', oldVal: undefined, newVal: r.new_status })
      if (r.new_data) {
        const newData = JSON.parse(r.new_data) as Record<string, unknown>
        for (const key of Object.keys(newData)) {
          changes.push({ field: key, oldVal: undefined, newVal: newData[key] })
        }
      }
    } else if (r.action === 'deleted' && r.old_status != null) {
      changes.push({ field: 'status', oldVal: r.old_status, newVal: undefined })
      if (r.old_data) {
        const oldData = JSON.parse(r.old_data) as Record<string, unknown>
        for (const key of Object.keys(oldData)) {
          changes.push({ field: key, oldVal: oldData[key], newVal: undefined })
        }
      }
    }
    return {
      at: r.changed_at,
      by: r.changed_by_name || r.changed_by,
      byId: r.changed_by,
      action: r.action,
      changes,
    }
  })

  res.json(entries)
})

router.post('/', requireCanEditData, (req: AuthRequest, res) => {
  const { testPlanId, testId, data, status, recordedAt: bodyRecordedAt } = req.body
  if (!testPlanId || !req.user) {
    return res.status(400).json({ error: 'testPlanId required' })
  }
  if (!testId || typeof testId !== 'string' || !testId.trim()) {
    return res.status(400).json({ error: 'testId required' })
  }
  if (!status || !['pass', 'fail', 'partial'].includes(status)) {
    return res.status(400).json({ error: 'status required (pass, fail, or partial)' })
  }

  const plan = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(testPlanId)
  if (!plan) return res.status(404).json({ error: 'Test plan not found' })
  const test = db.prepare('SELECT id FROM tests WHERE id = ? AND test_plan_id = ?').get(testId.trim(), testPlanId)
  if (!test) return res.status(404).json({ error: 'Test not found' })

  const id = uuidv4()
  let recordedAt: string
  if (typeof bodyRecordedAt === 'string' && bodyRecordedAt.trim()) {
    const parsed = new Date(bodyRecordedAt.trim())
    recordedAt = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
  } else {
    recordedAt = new Date().toISOString()
  }

  const newData = data ? JSON.stringify(data) : null
  db.prepare(
    'INSERT INTO test_runs (id, test_plan_id, test_id, run_at, entered_by, status, data, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, testPlanId, testId.trim(), recordedAt, req.user.id, status, newData, null)

  insertRecordHistory(id, 'created', null, null, newData, status, req.user.id)

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
    run_id?: string | null
    test_id?: string | null
  }

  res.status(201).json({
    id: row.id,
    testPlanId: row.test_plan_id,
    testId: row.test_id ?? undefined,
    planName: row.plan_name,
    recordedAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
    runId: row.run_id ?? undefined,
  })
})

router.put('/:id', requireCanEditData, (req: AuthRequest, res) => {
  const { id } = req.params
  const { data, status, testId: bodyTestId } = req.body

  const existing = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as {
    id: string
    test_plan_id: string
    run_at: string
    entered_by: string
    status: string
    data: string | null
    test_id?: string | null
    run_id?: string | null
  } | undefined
  if (!existing) return res.status(404).json({ error: 'Record not found' })

  if (bodyTestId !== undefined) {
    const targetTest = db
      .prepare('SELECT id FROM tests WHERE id = ? AND test_plan_id = ?')
      .get(bodyTestId, existing.test_plan_id)
    if (!targetTest) return res.status(400).json({ error: 'Target test not found or does not belong to this plan' })
  }

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
  if (bodyTestId !== undefined) {
    updates.push('test_id = ?')
    values.push(typeof bodyTestId === 'string' && bodyTestId.trim() ? bodyTestId.trim() : null)
  }
  if (updates.length === 0) {
    const planRow = db.prepare('SELECT name FROM test_plans WHERE id = ?').get(existing.test_plan_id) as { name: string }
    return res.json({
      id: existing.id,
      testPlanId: existing.test_plan_id,
      testId: existing.test_id ?? undefined,
      planName: planRow?.name || '',
      recordedAt: existing.run_at,
      enteredBy: existing.entered_by,
      status: existing.status,
      data: existing.data ? JSON.parse(existing.data) : {},
      runId: existing.run_id ?? undefined,
    })
  }
  values.push(id)
  db.prepare(`UPDATE test_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const newData = data !== undefined ? JSON.stringify(data) : existing.data
  const newStatus = status !== undefined ? status : existing.status
  insertRecordHistory(
    id,
    'updated',
    existing.data,
    existing.status,
    newData,
    newStatus,
    req.user!.id
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
    test_id?: string | null
    run_id?: string | null
  }
  res.json({
    id: row.id,
    testPlanId: row.test_plan_id,
    testId: row.test_id ?? undefined,
    planName: row.plan_name,
    recordedAt: row.run_at,
    enteredBy: row.entered_by,
    status: row.status,
    data: row.data ? JSON.parse(row.data) : {},
    runId: row.run_id ?? undefined,
  })
})

router.delete('/:id', requireCanEditData, (req: AuthRequest, res) => {
  const id = req.params.id
  const row = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as {
    id: string
    data: string | null
    status: string
  } | undefined
  if (!row) return res.status(404).json({ error: 'Record not found' })
  insertRecordHistory(id, 'deleted', row.data, row.status, null, null, req.user!.id)
  db.prepare('DELETE FROM test_runs WHERE id = ?').run(id)
  res.status(204).send()
})

export { router as recordsRouter }
