import { Router, type Request } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { toIsoUtcString } from '../lib/timestamps.js'
import { authMiddleware, requireAdmin } from '../middleware/auth.js'

const router = Router({ mergeParams: true })

router.use(authMiddleware)

type Params = { planId: string; testId?: string }

/** Latest activity for a test: metadata, record creates, and record_history edits. */
function getLastEditedAtIsoForTest(testId: string, fallbackCreatedAt: string): string {
  const act = db
    .prepare(
      `SELECT MAX(CAST(strftime('%s', x.ts) AS INTEGER)) AS max_epoch
       FROM (
         SELECT t.updated_at AS ts FROM tests t WHERE t.id = ? AND t.updated_at IS NOT NULL
         UNION ALL
         SELECT t.created_at FROM tests t WHERE t.id = ?
         UNION ALL
         SELECT tr.run_at FROM test_runs tr WHERE tr.test_id = ?
         UNION ALL
         SELECT rh.changed_at FROM record_history rh
         INNER JOIN test_runs tr ON tr.id = rh.record_id
         WHERE tr.test_id = ?
       ) x
       WHERE x.ts IS NOT NULL AND length(trim(x.ts)) > 0`
    )
    .get(testId, testId, testId, testId) as { max_epoch: number | string | null } | undefined
  if (act?.max_epoch != null) {
    const n = typeof act.max_epoch === 'string' ? parseInt(act.max_epoch, 10) : act.max_epoch
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString()
  }
  return toIsoUtcString(fallbackCreatedAt) ?? fallbackCreatedAt
}

router.get('/', (req: Request<Params>, res) => {
  const planId = req.params.planId
  const plan = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(planId)
  if (!plan) return res.status(404).json({ error: 'Test plan not found' })

  const includeArchived = req.query.archived === 'true'
  // Migration creates synthetic rows id = legacy-<planId> to attach pre–test_id records.
  // Hide them in the UI once the plan has real tests; keep them visible if they are the only bucket.
  const legacyListFilter = includeArchived
    ? ''
    : `AND (
    t.id NOT LIKE 'legacy-%'
    OR NOT EXISTS (
      SELECT 1 FROM tests t2
      WHERE t2.test_plan_id = t.test_plan_id
      AND t2.archived = 0
      AND t2.id NOT LIKE 'legacy-%'
    )
  )`

  const rows = db
    .prepare(
      `SELECT t.id, t.test_plan_id, t.name, t.start_date, t.end_date, t.archived, t.created_at, t.updated_at,
       (SELECT COUNT(*) FROM test_runs tr WHERE tr.test_id = t.id) as record_count
       FROM tests t
       WHERE t.test_plan_id = ?
       ${includeArchived ? '' : 'AND t.archived = 0'}
       ${legacyListFilter}
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

  const activityRows = db
    .prepare(
      `SELECT x.test_id AS test_id, MAX(CAST(strftime('%s', x.ts) AS INTEGER)) AS max_epoch
       FROM (
         SELECT t.id AS test_id, t.updated_at AS ts
         FROM tests t
         WHERE t.test_plan_id = ? AND t.updated_at IS NOT NULL
         UNION ALL
         SELECT t.id, t.created_at FROM tests t WHERE t.test_plan_id = ?
         UNION ALL
         SELECT tr.test_id, tr.run_at FROM test_runs tr
         WHERE tr.test_plan_id = ? AND tr.test_id IS NOT NULL
         UNION ALL
         SELECT tr.test_id, rh.changed_at
         FROM record_history rh
         INNER JOIN test_runs tr ON tr.id = rh.record_id
         WHERE tr.test_plan_id = ?
       ) x
       WHERE x.test_id IS NOT NULL AND x.ts IS NOT NULL AND length(trim(x.ts)) > 0
       GROUP BY x.test_id`
    )
    .all(planId, planId, planId, planId) as Array<{ test_id: string; max_epoch: number | string | null }>
  const lastEpochByTest = new Map<string, number>()
  for (const a of activityRows) {
    if (a.max_epoch == null) continue
    const n = typeof a.max_epoch === 'string' ? parseInt(a.max_epoch, 10) : a.max_epoch
    if (Number.isFinite(n)) lastEpochByTest.set(a.test_id, n)
  }

  res.json(
    rows.map((r) => {
      const epoch = lastEpochByTest.get(r.id)
      const lastEditedAt =
        epoch != null && Number.isFinite(epoch)
          ? new Date(epoch * 1000).toISOString()
          : toIsoUtcString(r.created_at) ?? r.created_at
      const createdAtNorm = toIsoUtcString(r.created_at) ?? r.created_at
      const updatedAtNorm = toIsoUtcString(r.updated_at)
      return {
        id: r.id,
        testPlanId: r.test_plan_id,
        name: r.name,
        startDate: r.start_date ?? undefined,
        endDate: r.end_date ?? undefined,
        archived: Boolean(r.archived),
        createdAt: createdAtNorm,
        updatedAt: updatedAtNorm ?? undefined,
        lastEditedAt,
        recordCount: r.record_count,
      }
    })
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
  const createdNorm = toIsoUtcString(row.created_at) ?? row.created_at
  res.status(201).json({
    id: row.id,
    testPlanId: row.test_plan_id,
    name: row.name,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    archived: false,
    createdAt: createdNorm,
    lastEditedAt: getLastEditedAtIsoForTest(row.id, row.created_at),
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
    createdAt: toIsoUtcString(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtcString(row.updated_at) ?? undefined,
    lastEditedAt: getLastEditedAtIsoForTest(row.id, row.created_at),
    recordCount: row.record_count ?? 0,
  })
})

router.put('/:testId', requireAdmin, (req: Request<Params>, res) => {
  const planId = req.params.planId
  const testId = req.params.testId
  if (typeof testId !== 'string' || !testId.trim()) {
    return res.status(400).json({ error: 'Test id required' })
  }
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
      createdAt: toIsoUtcString(test.created_at) ?? test.created_at,
      updatedAt: toIsoUtcString(testRow.updated_at ?? null) ?? undefined,
      lastEditedAt: getLastEditedAtIsoForTest(testId, test.created_at),
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
    createdAt: toIsoUtcString(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtcString(row.updated_at) ?? undefined,
    lastEditedAt: getLastEditedAtIsoForTest(row.id, row.created_at),
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
