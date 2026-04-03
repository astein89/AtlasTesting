import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { toIsoUtcString } from '../lib/timestamps.js'
import { authMiddleware, requirePermission } from '../middleware/auth.js'
import { testsRouter } from './tests.js'

const router = Router()

router.use(authMiddleware)
router.use(requirePermission('module.testing'))

router.use('/:planId/tests', testsRouter)

function parseFormLayoutOrder(formLayout: string | null): string[] {
  try {
    const parsed = formLayout ? JSON.parse(formLayout) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseStringArray(json: string | null): string[] {
  try {
    const parsed = json ? JSON.parse(json) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
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
    updated_at?: string | null
  }>
  const counts = db
    .prepare(
      `SELECT test_plan_id, COUNT(*) as cnt FROM test_runs GROUP BY test_plan_id`
    )
    .all() as Array<{ test_plan_id: string; cnt: number }>
  const countByPlan = new Map(counts.map((c) => [c.test_plan_id, c.cnt]))

  const activityRows = db
    .prepare(
      `SELECT x.plan_id AS plan_id, MAX(CAST(strftime('%s', x.ts) AS INTEGER)) AS max_epoch
       FROM (
         SELECT tr.test_plan_id AS plan_id, rh.changed_at AS ts
         FROM record_history rh
         INNER JOIN test_runs tr ON tr.id = rh.record_id
         UNION ALL
         SELECT tr.test_plan_id, tr.run_at FROM test_runs tr
         UNION ALL
         SELECT t.test_plan_id, t.updated_at FROM tests t WHERE t.updated_at IS NOT NULL
         UNION ALL
         SELECT t.test_plan_id, t.created_at FROM tests t
         UNION ALL
         SELECT id AS plan_id, updated_at AS ts FROM test_plans WHERE updated_at IS NOT NULL
         UNION ALL
         SELECT id, created_at FROM test_plans
       ) x
       WHERE x.ts IS NOT NULL AND length(trim(x.ts)) > 0
       GROUP BY x.plan_id`
    )
    .all() as Array<{ plan_id: string; max_epoch: number | string | null }>
  const lastEpochByPlan = new Map<string, number>()
  for (const a of activityRows) {
    if (a.max_epoch == null) continue
    const n = typeof a.max_epoch === 'string' ? parseInt(a.max_epoch, 10) : a.max_epoch
    if (Number.isFinite(n)) lastEpochByPlan.set(a.plan_id, n)
  }

  res.json(
    rows.map((r) => {
      const epoch = lastEpochByPlan.get(r.id)
      const lastEditedAt =
        epoch != null && Number.isFinite(epoch)
          ? new Date(epoch * 1000).toISOString()
          : toIsoUtcString(r.created_at) ?? r.created_at
      const createdAtNorm = toIsoUtcString(r.created_at) ?? r.created_at
      const updatedAtNorm = toIsoUtcString((r as { updated_at?: string | null }).updated_at)

      return {
        id: r.id,
        name: r.name,
        description: (r as { short_description?: string | null }).short_description ?? null,
        testPlan: r.description,
        constraints: (r as { constraints?: string | null }).constraints ?? null,
        fieldIds: r.field_ids ? JSON.parse(r.field_ids) : [],
        fieldLayout: r.field_layout ? JSON.parse(r.field_layout) : {},
        formLayoutOrder: parseFormLayoutOrder(r.form_layout),
        keyField: (r as { key_field?: string | null }).key_field ?? undefined,
        startDate: (r as { start_date?: string | null }).start_date ?? undefined,
        endDate: (r as { end_date?: string | null }).end_date ?? undefined,
        archivedRuns: parseArchivedRuns((r as { archived_runs?: string | null }).archived_runs ?? null),
        hiddenFieldIds: parseStringArray((r as { hidden_field_ids?: string | null }).hidden_field_ids ?? null),
        requiredFieldIds: parseStringArray((r as { required_field_ids?: string | null }).required_field_ids ?? null),
        defaultVisibleColumnIds: parseStringArray(
          (r as { default_visible_columns?: string | null }).default_visible_columns ?? null
        ),
        conditionalStatusRules: parseConditionalStatusRules(
          (r as { conditional_status_rules?: string | null }).conditional_status_rules ?? null
        ),
        conditionalStatusRuleOrder: parseConditionalStatusRuleOrder(
          (r as { conditional_status_rule_order?: string | null }).conditional_status_rule_order ?? null
        ),
        createdAt: createdAtNorm,
        updatedAt: updatedAtNorm,
        lastEditedAt,
        recordCount: countByPlan.get(r.id) ?? 0,
      }
    })
  )
})

function parseDefaultSortOrder(json: string | null): Array<{ key: string; dir: 'asc' | 'desc' }> {
  try {
    const parsed = json ? JSON.parse(json) : null
    if (!Array.isArray(parsed) || parsed.length === 0) return []
    return parsed.filter(
      (x): x is { key: string; dir: 'asc' | 'desc' } =>
        x && typeof x.key === 'string' && (x.dir === 'asc' || x.dir === 'desc')
    )
  } catch {
    return []
  }
}

function parseFieldDefaults(json: string | null): Record<string, string | number | boolean | string[]> {
  try {
    const parsed = json ? JSON.parse(json) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string | number | boolean | string[]> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k !== 'string') continue
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
      else if (Array.isArray(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Stop any running timers in record data (finalize totalElapsedMs, clear startedAt). */
function stopTimersInData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const now = Date.now()
  for (const [k, v] of Object.entries(data)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v) && 'totalElapsedMs' in v && 'startedAt' in v) {
      const t = v as Record<string, unknown>
      const total = typeof t.totalElapsedMs === 'number' && t.totalElapsedMs >= 0 ? t.totalElapsedMs : 0
      const startedAt = typeof t.startedAt === 'string' ? t.startedAt : ''
      const startMs = Date.parse(startedAt)
      const added = Number.isNaN(startMs) ? 0 : Math.max(0, now - startMs)
      const stopped: Record<string, unknown> = { ...t, totalElapsedMs: total + added }
      delete stopped.startedAt
      out[k] = stopped
    } else {
      out[k] = v
    }
  }
  return out
}

function parseArchivedRuns(json: string | null): Array<{ startDate: string; endDate: string; runId?: string }> {
  try {
    const parsed = json ? JSON.parse(json) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is { startDate: string; endDate: string; runId?: string } =>
        x && typeof x.startDate === 'string' && typeof x.endDate === 'string'
    )
  } catch {
    return []
  }
}

const STANDARD_OPS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'not_contains',
  'begins_with',
  'ends_with',
  'blank',
  'not_blank',
])

function parseConditionalStatusRules(
  json: string | null | undefined
): Record<string, Record<string, Record<string, unknown> | null>> {
  try {
    const parsed = json ? JSON.parse(json) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, Record<string, Record<string, unknown> | null>> = {}
    for (const [fieldId, inner] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof fieldId !== 'string' || !inner || typeof inner !== 'object' || Array.isArray(inner)) continue
      const innerOut: Record<string, Record<string, unknown> | null> = {}
      for (const [opt, cond] of Object.entries(inner as Record<string, unknown>)) {
        if (typeof opt !== 'string') continue
        if (cond == null) {
          innerOut[opt] = null
          continue
        }
        if (typeof cond !== 'object' || Array.isArray(cond)) continue
        const c = cond as Record<string, unknown>
        const mode = c.mode
        if (mode !== 'formula' && mode !== 'standard') continue
        const row: Record<string, unknown> = { mode }
        if (typeof c.id === 'string' && c.id) row.id = c.id
        if (mode === 'formula' && typeof c.formula === 'string') row.formula = c.formula
        if (mode === 'standard') {
          const parsedClauses: Record<string, unknown>[] = []
          if (Array.isArray(c.standardClauses)) {
            for (let i = 0; i < c.standardClauses.length; i++) {
              const raw = c.standardClauses[i]
              if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
              const o = raw as Record<string, unknown>
              const fk = typeof o.fieldKey === 'string' ? o.fieldKey.trim() : ''
              if (!fk) continue
              if (typeof o.op !== 'string' || !STANDARD_OPS.has(o.op)) continue
              const piece: Record<string, unknown> = { fieldKey: fk, op: o.op }
              if (i > 0) {
                piece.combine =
                  typeof o.combine === 'string' && o.combine === 'or' ? 'or' : 'and'
              }
              if (typeof o.value === 'string') piece.value = o.value
              if (typeof o.value2 === 'string') piece.value2 = o.value2
              parsedClauses.push(piece)
            }
          }
          if (parsedClauses.length > 0) {
            row.standardClauses = parsedClauses
          } else {
            if (typeof c.standardFieldKey === 'string' && c.standardFieldKey.trim()) {
              row.standardFieldKey = c.standardFieldKey.trim()
            }
            if (typeof c.standardOp === 'string' && STANDARD_OPS.has(c.standardOp)) {
              row.standardOp = c.standardOp
            }
            if (typeof c.standardValue === 'string') row.standardValue = c.standardValue
            if (typeof c.standardValue2 === 'string') row.standardValue2 = c.standardValue2
            if (typeof c.standardLogicalOp === 'string' && (c.standardLogicalOp === 'and' || c.standardLogicalOp === 'or')) {
              row.standardLogicalOp = c.standardLogicalOp
            }
            if (typeof c.standardFieldKey2 === 'string' && c.standardFieldKey2.trim()) {
              row.standardFieldKey2 = c.standardFieldKey2.trim()
            }
            if (typeof c.standardOp2 === 'string' && STANDARD_OPS.has(c.standardOp2)) {
              row.standardOp2 = c.standardOp2
            }
            if (typeof c.standardValueB === 'string') row.standardValueB = c.standardValueB
            if (typeof c.standardValue2B === 'string') row.standardValue2B = c.standardValue2B
          }
        }
        innerOut[opt] = row
      }
      if (Object.keys(innerOut).length > 0) out[fieldId] = innerOut
    }
    return out
  } catch {
    return {}
  }
}

/** `undefined` = omit column update (PUT). `null` / empty = clear stored rules. */
function conditionalStatusRulesToJson(
  body: unknown
): string | null | undefined {
  if (body === undefined) return undefined
  if (body === null) return null
  if (typeof body !== 'object' || Array.isArray(body)) return null
  const cleaned: Record<string, Record<string, Record<string, unknown> | null>> = {}
  for (const [fieldId, inner] of Object.entries(body as Record<string, unknown>)) {
    if (typeof fieldId !== 'string' || !inner || typeof inner !== 'object' || Array.isArray(inner)) continue
    const innerOut: Record<string, Record<string, unknown> | null> = {}
    for (const [opt, cond] of Object.entries(inner as Record<string, unknown>)) {
      if (typeof opt !== 'string') continue
      if (cond == null) {
        innerOut[opt] = null
        continue
      }
      if (typeof cond !== 'object' || Array.isArray(cond)) continue
      const c = cond as Record<string, unknown>
      const mode = c.mode
      if (mode !== 'formula' && mode !== 'standard') continue
      const row: Record<string, unknown> = { mode }
      if (typeof c.id === 'string' && c.id) row.id = c.id
      if (mode === 'formula' && typeof c.formula === 'string') row.formula = c.formula
      if (mode === 'standard') {
        const sc = c.standardClauses
        if (Array.isArray(sc) && sc.length > 0) {
          const arr: Record<string, unknown>[] = []
          for (let i = 0; i < sc.length; i++) {
            const it = sc[i] as Record<string, unknown>
            if (!it || typeof it !== 'object') continue
            const fk = typeof it.fieldKey === 'string' ? it.fieldKey.trim() : ''
            if (!fk) continue
            if (typeof it.op !== 'string' || !STANDARD_OPS.has(it.op)) continue
            const piece: Record<string, unknown> = { fieldKey: fk, op: it.op }
            if (i > 0) {
              piece.combine =
                typeof it.combine === 'string' && it.combine === 'or' ? 'or' : 'and'
            }
            if (typeof it.value === 'string') piece.value = it.value
            if (typeof it.value2 === 'string') piece.value2 = it.value2
            arr.push(piece)
          }
          if (arr.length > 0) row.standardClauses = arr
        } else {
          if (typeof c.standardFieldKey === 'string' && c.standardFieldKey.trim()) {
            row.standardFieldKey = c.standardFieldKey.trim()
          }
          if (typeof c.standardOp === 'string' && STANDARD_OPS.has(c.standardOp)) row.standardOp = c.standardOp
          if (typeof c.standardValue === 'string') row.standardValue = c.standardValue
          if (typeof c.standardValue2 === 'string') row.standardValue2 = c.standardValue2
          if (typeof c.standardLogicalOp === 'string' && (c.standardLogicalOp === 'and' || c.standardLogicalOp === 'or')) {
            row.standardLogicalOp = c.standardLogicalOp
          }
          if (typeof c.standardFieldKey2 === 'string' && c.standardFieldKey2.trim()) {
            row.standardFieldKey2 = c.standardFieldKey2.trim()
          }
          if (typeof c.standardOp2 === 'string' && STANDARD_OPS.has(c.standardOp2)) row.standardOp2 = c.standardOp2
          if (typeof c.standardValueB === 'string') row.standardValueB = c.standardValueB
          if (typeof c.standardValue2B === 'string') row.standardValue2B = c.standardValue2B
        }
      }
      innerOut[opt] = row
    }
    if (Object.keys(innerOut).length > 0) cleaned[fieldId] = innerOut
  }
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null
}

function parseConditionalStatusRuleOrder(json: string | null | undefined): Record<string, string[]> {
  try {
    const parsed = json ? JSON.parse(json) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string[]> = {}
    for (const [fieldId, arr] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof fieldId !== 'string' || !Array.isArray(arr)) continue
      const labels = arr.filter((x): x is string => typeof x === 'string')
      out[fieldId] = labels
    }
    return out
  } catch {
    return {}
  }
}

/** `undefined` = omit column update (PUT). `null` / empty = clear stored order. */
function conditionalStatusRuleOrderToJson(body: unknown): string | null | undefined {
  if (body === undefined) return undefined
  if (body === null) return null
  if (typeof body !== 'object' || Array.isArray(body)) return null
  const cleaned: Record<string, string[]> = {}
  for (const [fieldId, arr] of Object.entries(body as Record<string, unknown>)) {
    if (typeof fieldId !== 'string' || !Array.isArray(arr)) continue
    const labels = arr.filter((x): x is string => typeof x === 'string')
    cleaned[fieldId] = labels
  }
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null
}

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
    default_sort_order?: string | null
    field_defaults?: string | null
    key_field?: string | null
    created_at: string
    default_visible_columns?: string | null
  } | undefined
  if (!row) return res.status(404).json({ error: 'Test plan not found' })
  res.json({
    id: row.id,
    name: row.name,
    description: (row as { short_description?: string | null }).short_description ?? null,
    testPlan: row.description,
    constraints: row.constraints ?? null,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    formLayoutOrder: parseFormLayoutOrder(row.form_layout),
    defaultSortOrder: parseDefaultSortOrder((row as { default_sort_order?: string | null }).default_sort_order ?? null),
    fieldDefaults: parseFieldDefaults((row as { field_defaults?: string | null }).field_defaults ?? null),
    keyField: (row as { key_field?: string | null }).key_field ?? undefined,
    startDate: (row as { start_date?: string | null }).start_date ?? undefined,
    endDate: (row as { end_date?: string | null }).end_date ?? undefined,
    archivedRuns: parseArchivedRuns((row as { archived_runs?: string | null }).archived_runs ?? null),
    hiddenFieldIds: parseStringArray((row as { hidden_field_ids?: string | null }).hidden_field_ids ?? null),
    requiredFieldIds: parseStringArray((row as { required_field_ids?: string | null }).required_field_ids ?? null),
    defaultVisibleColumnIds: parseStringArray(
      (row as { default_visible_columns?: string | null }).default_visible_columns ?? null
    ),
    conditionalStatusRules: parseConditionalStatusRules(
      (row as { conditional_status_rules?: string | null }).conditional_status_rules ?? null
    ),
    conditionalStatusRuleOrder: parseConditionalStatusRuleOrder(
      (row as { conditional_status_rule_order?: string | null }).conditional_status_rule_order ?? null
    ),
    createdAt: row.created_at,
  })
})

router.post('/', requirePermission('testing.plans.manage'), (req, res) => {
  const { name, description, constraints, testPlan, fieldIds, fieldLayout, formLayoutOrder, defaultSortOrder, fieldDefaults, keyField, startDate, endDate, hiddenFieldIds, requiredFieldIds } =
    req.body
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
  const defaultSortJson =
    Array.isArray(defaultSortOrder) && defaultSortOrder.length > 0
      ? JSON.stringify(defaultSortOrder)
      : null
  const fieldDefaultsJson =
    fieldDefaults && typeof fieldDefaults === 'object' && Object.keys(fieldDefaults).length > 0
      ? JSON.stringify(fieldDefaults)
      : null
  const keyFieldVal = typeof keyField === 'string' && keyField.trim() ? keyField.trim() : null
  const startDateVal = typeof startDate === 'string' && startDate.trim() ? startDate.trim() : null
  const endDateVal = typeof endDate === 'string' && endDate.trim() ? endDate.trim() : null
  const hiddenFieldIdsJson = Array.isArray(hiddenFieldIds) ? JSON.stringify(hiddenFieldIds) : null
  const requiredFieldIdsJson = Array.isArray(requiredFieldIds) ? JSON.stringify(requiredFieldIds) : null
  const defaultVisibleColumnsJson =
    Array.isArray((req.body as { defaultVisibleColumnIds?: string[] }).defaultVisibleColumnIds) &&
    (req.body as { defaultVisibleColumnIds?: string[] }).defaultVisibleColumnIds!.length > 0
      ? JSON.stringify((req.body as { defaultVisibleColumnIds?: string[] }).defaultVisibleColumnIds)
      : null
  const conditionalStatusJson =
    conditionalStatusRulesToJson((req.body as { conditionalStatusRules?: unknown }).conditionalStatusRules) ?? null
  const conditionalStatusRuleOrderJson =
    conditionalStatusRuleOrderToJson(
      (req.body as { conditionalStatusRuleOrder?: unknown }).conditionalStatusRuleOrder
    ) ?? null
  db.prepare(
    'INSERT INTO test_plans (id, name, description, constraints, short_description, field_ids, field_layout, form_layout, default_sort_order, field_defaults, key_field, start_date, end_date, archived_runs, hidden_field_ids, required_field_ids, default_visible_columns, conditional_status_rules, conditional_status_rule_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    name,
    testPlan || null,
    constraints || null,
    description || null,
    fieldIdsJson,
    fieldLayoutJson,
    formLayoutJson,
    defaultSortJson,
    fieldDefaultsJson,
    keyFieldVal,
    startDateVal,
    endDateVal,
    null,
    hiddenFieldIdsJson,
    requiredFieldIdsJson,
    defaultVisibleColumnsJson,
    conditionalStatusJson,
    conditionalStatusRuleOrderJson
  )

  const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
    id: string
    name: string
    description: string | null
    constraints?: string | null
    short_description?: string | null
    field_ids: string | null
    field_layout: string | null
    form_layout: string | null
    default_sort_order?: string | null
    field_defaults?: string | null
    key_field?: string | null
    created_at: string
  }
  res.status(201).json({
    id: row.id,
    name: row.name,
    description: (row as { short_description?: string | null }).short_description ?? null,
    testPlan: row.description,
    constraints: row.constraints ?? null,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    formLayoutOrder: parseFormLayoutOrder(row.form_layout),
    defaultSortOrder: parseDefaultSortOrder((row as { default_sort_order?: string | null }).default_sort_order ?? null),
    fieldDefaults: parseFieldDefaults((row as { field_defaults?: string | null }).field_defaults ?? null),
    keyField: (row as { key_field?: string | null }).key_field ?? undefined,
    startDate: (row as { start_date?: string | null }).start_date ?? undefined,
    endDate: (row as { end_date?: string | null }).end_date ?? undefined,
    archivedRuns: parseArchivedRuns((row as { archived_runs?: string | null }).archived_runs ?? null),
    hiddenFieldIds: parseStringArray((row as { hidden_field_ids?: string | null }).hidden_field_ids ?? null),
    requiredFieldIds: parseStringArray((row as { required_field_ids?: string | null }).required_field_ids ?? null),
    defaultVisibleColumnIds: parseStringArray(
      (row as { default_visible_columns?: string | null }).default_visible_columns ?? null
    ),
    conditionalStatusRules: parseConditionalStatusRules(
      (row as { conditional_status_rules?: string | null }).conditional_status_rules ?? null
    ),
    conditionalStatusRuleOrder: parseConditionalStatusRuleOrder(
      (row as { conditional_status_rule_order?: string | null }).conditional_status_rule_order ?? null
    ),
    createdAt: row.created_at,
  })
})

router.put('/:id', requirePermission('testing.plans.manage'), (req, res) => {
  const {
    name,
    description,
    constraints,
    testPlan,
    fieldIds,
    fieldLayout,
    formLayoutOrder,
    defaultSortOrder,
    fieldDefaults,
    keyField,
    startDate,
    endDate,
    archivedRuns,
    hiddenFieldIds,
    requiredFieldIds,
    defaultVisibleColumnIds,
    conditionalStatusRules,
    conditionalStatusRuleOrder,
  } = req.body
  const { id } = req.params

  const existing = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Test plan not found' })

  if (typeof name === 'string' && !name.trim()) {
    return res.status(400).json({ error: 'name required' })
  }

  // Enforce that plan-specific fields cannot be attached to other plans.
  if (Array.isArray(fieldIds) && fieldIds.length > 0) {
    const placeholders = fieldIds.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT id, owner_test_plan_id FROM fields WHERE id IN (${placeholders})`
      )
      .all(...fieldIds) as Array<{ id: string; owner_test_plan_id: string | null }>
    for (const row of rows) {
      if (row.owner_test_plan_id && row.owner_test_plan_id !== id) {
        return res
          .status(400)
          .json({ error: 'Cannot add plan-specific fields to other test plans' })
      }
    }
  }

  const updates: string[] = []
  const values: unknown[] = []
  if (name !== undefined && name !== null) {
    updates.push('name = ?')
    values.push(typeof name === 'string' ? name.trim() : name)
  }
  if (testPlan !== undefined) {
    updates.push('description = ?')
    values.push(typeof testPlan === 'string' ? testPlan.trim() || null : testPlan)
  }
  if (constraints !== undefined) {
    updates.push('constraints = ?')
    values.push(constraints)
  }
  if (description !== undefined) {
    updates.push('short_description = ?')
    values.push(typeof description === 'string' ? description.trim() || null : description)
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
  if (defaultSortOrder !== undefined) {
    updates.push('default_sort_order = ?')
    values.push(
      Array.isArray(defaultSortOrder) && defaultSortOrder.length > 0
        ? JSON.stringify(defaultSortOrder)
        : null
    )
  }
  if (fieldDefaults !== undefined) {
    updates.push('field_defaults = ?')
    values.push(
      fieldDefaults && typeof fieldDefaults === 'object' && Object.keys(fieldDefaults).length > 0
        ? JSON.stringify(fieldDefaults)
        : null
    )
  }
  if (keyField !== undefined) {
    updates.push('key_field = ?')
    values.push(typeof keyField === 'string' && keyField.trim() ? keyField.trim() : null)
  }
  if (startDate !== undefined) {
    updates.push('start_date = ?')
    values.push(typeof startDate === 'string' && startDate.trim() ? startDate.trim() : null)
  }
  if (endDate !== undefined) {
    updates.push('end_date = ?')
    values.push(typeof endDate === 'string' && endDate.trim() ? endDate.trim() : null)
  }
  if (hiddenFieldIds !== undefined) {
    updates.push('hidden_field_ids = ?')
    values.push(Array.isArray(hiddenFieldIds) ? JSON.stringify(hiddenFieldIds) : null)
  }
  if (requiredFieldIds !== undefined) {
    updates.push('required_field_ids = ?')
    values.push(Array.isArray(requiredFieldIds) ? JSON.stringify(requiredFieldIds) : null)
  }
  if (defaultVisibleColumnIds !== undefined) {
    updates.push('default_visible_columns = ?')
    values.push(
      Array.isArray(defaultVisibleColumnIds) && defaultVisibleColumnIds.length > 0
        ? JSON.stringify(defaultVisibleColumnIds)
        : null
    )
  }
  if (conditionalStatusRules !== undefined) {
    const ser = conditionalStatusRulesToJson(conditionalStatusRules)
    if (ser !== undefined) {
      updates.push('conditional_status_rules = ?')
      values.push(ser)
    }
  }
  if (conditionalStatusRuleOrder !== undefined) {
    const ser = conditionalStatusRuleOrderToJson(conditionalStatusRuleOrder)
    if (ser !== undefined) {
      updates.push('conditional_status_rule_order = ?')
      values.push(ser)
    }
  }
  if (archivedRuns !== undefined && Array.isArray(archivedRuns)) {
    const planRow = db.prepare('SELECT archived_runs FROM test_plans WHERE id = ?').get(id) as { archived_runs: string | null } | undefined
    const oldRuns = parseArchivedRuns(planRow?.archived_runs ?? null)
    const newRuns = archivedRuns.filter(
      (x: unknown): x is { startDate: string; endDate: string; runId?: string } =>
        x != null && typeof x === 'object' && 'startDate' in x && 'endDate' in x && typeof (x as { startDate: unknown }).startDate === 'string' && typeof (x as { endDate: unknown }).endDate === 'string'
    )
    const runByKey = (r: { startDate: string; endDate: string }) => `${r.startDate}\t${r.endDate}`
    const oldByKey = new Map(oldRuns.map((r) => [runByKey(r), r]))
    const newByKey = new Map(newRuns.map((r) => [runByKey(r), r]))

    const finalRuns: Array<{ startDate: string; endDate: string; runId?: string }> = []
    for (const run of newRuns) {
      const key = runByKey(run)
      const existing = oldByKey.get(key)
      let runId = run.runId ?? existing?.runId
      if (!runId) {
        runId = uuidv4()
        db.prepare(
          'UPDATE test_runs SET run_id = ? WHERE test_plan_id = ? AND (run_id IS NULL OR run_id = ?)'
        ).run(runId, id, '')
        const rows = db.prepare('SELECT id, data FROM test_runs WHERE test_plan_id = ? AND run_id = ?').all(id, runId) as Array<{ id: string; data: string | null }>
        for (const row of rows) {
          if (!row.data) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(row.data)
          } catch {
            continue
          }
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
          const stopped = stopTimersInData(parsed as Record<string, unknown>)
          db.prepare('UPDATE test_runs SET data = ? WHERE id = ?').run(JSON.stringify(stopped), row.id)
        }
      }
      finalRuns.push({ startDate: run.startDate, endDate: run.endDate, runId })
    }
    for (const run of oldRuns) {
      if (newByKey.has(runByKey(run))) continue
      const rid = run.runId
      if (rid) {
        db.prepare('UPDATE test_runs SET run_id = NULL WHERE test_plan_id = ? AND run_id = ?').run(id, rid)
      } else {
        db.prepare(
          'UPDATE test_runs SET run_id = NULL WHERE test_plan_id = ? AND substr(run_at, 1, 10) >= ? AND substr(run_at, 1, 10) <= ?'
        ).run(id, run.startDate, run.endDate)
      }
    }
    updates.push('archived_runs = ?')
    values.push(finalRuns.length > 0 ? JSON.stringify(finalRuns) : null)
  }
  if (updates.length === 0) {
    const row = db.prepare('SELECT * FROM test_plans WHERE id = ?').get(id) as {
      updated_at?: string | null
      id: string
      name: string
      description: string | null
      constraints?: string | null
      field_ids: string | null
      field_layout: string | null
      form_layout: string | null
      default_sort_order?: string | null
      field_defaults?: string | null
      key_field?: string | null
      created_at: string
      default_visible_columns?: string | null
    }
    return res.json({
      id: row.id,
      name: row.name,
      description: (row as { short_description?: string | null }).short_description ?? null,
      testPlan: row.description,
      constraints: row.constraints ?? null,
      fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
      fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
      formLayoutOrder: parseFormLayoutOrder(row.form_layout),
      defaultSortOrder: parseDefaultSortOrder((row as { default_sort_order?: string | null }).default_sort_order ?? null),
      fieldDefaults: parseFieldDefaults((row as { field_defaults?: string | null }).field_defaults ?? null),
      keyField: (row as { key_field?: string | null }).key_field ?? undefined,
      startDate: (row as { start_date?: string | null }).start_date ?? undefined,
      endDate: (row as { end_date?: string | null }).end_date ?? undefined,
      archivedRuns: parseArchivedRuns((row as { archived_runs?: string | null }).archived_runs ?? null),
      hiddenFieldIds: parseStringArray((row as { hidden_field_ids?: string | null }).hidden_field_ids ?? null),
      requiredFieldIds: parseStringArray((row as { required_field_ids?: string | null }).required_field_ids ?? null),
      defaultVisibleColumnIds: parseStringArray(
        (row as { default_visible_columns?: string | null }).default_visible_columns ?? null
      ),
      conditionalStatusRules: parseConditionalStatusRules(
        (row as { conditional_status_rules?: string | null }).conditional_status_rules ?? null
      ),
      conditionalStatusRuleOrder: parseConditionalStatusRuleOrder(
        (row as { conditional_status_rule_order?: string | null }).conditional_status_rule_order ?? null
      ),
      createdAt: row.created_at,
      updatedAt: (row as { updated_at?: string | null }).updated_at ?? null,
    })
  }
  updates.push('updated_at = datetime(\'now\')')
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
    default_sort_order?: string | null
    field_defaults?: string | null
    key_field?: string | null
    created_at: string
    updated_at?: string | null
    default_visible_columns?: string | null
  }
  res.json({
    id: row.id,
    name: row.name,
    description: (row as { short_description?: string | null }).short_description ?? null,
    testPlan: row.description,
    constraints: row.constraints ?? null,
    fieldIds: row.field_ids ? JSON.parse(row.field_ids) : [],
    fieldLayout: row.field_layout ? JSON.parse(row.field_layout) : {},
    formLayoutOrder: parseFormLayoutOrder(row.form_layout),
    defaultSortOrder: parseDefaultSortOrder((row as { default_sort_order?: string | null }).default_sort_order ?? null),
    fieldDefaults: parseFieldDefaults((row as { field_defaults?: string | null }).field_defaults ?? null),
    keyField: (row as { key_field?: string | null }).key_field ?? undefined,
    startDate: (row as { start_date?: string | null }).start_date ?? undefined,
    endDate: (row as { end_date?: string | null }).end_date ?? undefined,
    archivedRuns: parseArchivedRuns((row as { archived_runs?: string | null }).archived_runs ?? null),
    hiddenFieldIds: parseStringArray((row as { hidden_field_ids?: string | null }).hidden_field_ids ?? null),
    requiredFieldIds: parseStringArray((row as { required_field_ids?: string | null }).required_field_ids ?? null),
    defaultVisibleColumnIds: parseStringArray(
      (row as { default_visible_columns?: string | null }).default_visible_columns ?? null
    ),
    conditionalStatusRules: parseConditionalStatusRules(
      (row as { conditional_status_rules?: string | null }).conditional_status_rules ?? null
    ),
    conditionalStatusRuleOrder: parseConditionalStatusRuleOrder(
      (row as { conditional_status_rule_order?: string | null }).conditional_status_rule_order ?? null
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  })
})

router.delete('/:id', requirePermission('testing.plans.manage'), (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT id FROM test_plans WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Test plan not found' })
  db.prepare('DELETE FROM test_runs WHERE test_plan_id = ?').run(id)
  db.prepare('DELETE FROM tests WHERE test_plan_id = ?').run(id)
  // Also remove any plan-specific fields owned by this plan
  db.prepare('DELETE FROM fields WHERE owner_test_plan_id = ?').run(id)
  db.prepare('DELETE FROM test_plans WHERE id = ?').run(id)
  res.status(204).send()
})

export { router as testPlansRouter }
