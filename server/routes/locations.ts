import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware, requireAdmin)

/** Cap for cartesian product size in POST .../locations/generate (memory + insert time). Override with LOCATION_GENERATE_MAX_ROWS (cannot exceed absolute cap). */
const DEFAULT_MAX_GENERATE_ROWS = 25_000
const ABSOLUTE_MAX_GENERATE_ROWS = 25_000
/** Old server hard cap; many deployments set LOCATION_GENERATE_MAX_ROWS=5000 to match — treat as “use default”, not a literal max. */
const LEGACY_ENV_MAX_ROWS = 5000

function getMaxGenerateRows(): number {
  const raw = process.env.LOCATION_GENERATE_MAX_ROWS
  if (raw == null || raw === '') return DEFAULT_MAX_GENERATE_ROWS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_GENERATE_ROWS
  if (n === LEGACY_ENV_MAX_ROWS) return DEFAULT_MAX_GENERATE_ROWS
  return Math.min(Math.floor(n), ABSOLUTE_MAX_GENERATE_ROWS)
}

/** Safe segment for Content-Disposition filename (ASCII). */
function sanitizeFilenameSegment(raw: string): string {
  const s = String(raw || 'zone')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return s || 'zone'
}

function buildMultiZoneExportFilename(
  zoneIds: string[],
  nameById: Map<string, string>
): string {
  const parts = zoneIds.map((id) => sanitizeFilenameSegment(nameById.get(id) ?? id))
  if (parts.length === 1) return `${parts[0]}-locations.csv`
  if (parts.length === 2) return `${parts[0]}-${parts[1]}-locations.csv`
  return `${parts[0]}-${parts[1]}-and-${parts.length - 2}-more-locations.csv`
}

/** Uppercase ASCII a–z only; other characters unchanged. */
function uppercaseAsciiLetters(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase())
}

function normalizeSelectFieldConfig(config: Record<string, unknown>): Record<string, unknown> {
  const options = Array.isArray(config.options)
    ? config.options.map((x) => uppercaseAsciiLetters(String(x)))
    : []
  const out: Record<string, unknown> = { ...config, options }
  if (Array.isArray(config.optionDescriptions)) {
    out.optionDescriptions = config.optionDescriptions.map((x) => String(x))
  }
  return out
}

function parseLocationSchemaFieldConfig(config: string | null): {
  options: string[]
  maxLength?: number
  optionDescriptions?: string[]
} {
  if (!config) return { options: [] }
  try {
    const o = JSON.parse(config) as { options?: unknown; maxLength?: unknown; optionDescriptions?: unknown }
    const options = Array.isArray(o.options) ? o.options.map((x) => String(x)) : []
    const maxLength =
      typeof o.maxLength === 'number' && o.maxLength > 0 ? Math.floor(o.maxLength) : undefined
    const optionDescriptions = Array.isArray(o.optionDescriptions)
      ? o.optionDescriptions.map((x) => String(x))
      : undefined
    return { options, maxLength, optionDescriptions }
  } catch {
    return { options: [] }
  }
}

type SchemaFieldDef = {
  key: string
  label: string
  type: string
  config: string | null
}

function normalizeLocationFieldValue(
  def: SchemaFieldDef,
  raw: unknown
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null }
  }
  const cfg = parseLocationSchemaFieldConfig(def.config)
  if (def.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${def.label}: invalid number` }
    }
    return { ok: true, value: n }
  }
  if (def.type === 'text') {
    const s = String(raw)
    if (cfg.maxLength != null && s.length > cfg.maxLength) {
      return { ok: false, error: `${def.label}: at most ${cfg.maxLength} character(s)` }
    }
    return { ok: true, value: s }
  }
  if (def.type === 'select') {
    const s = String(raw)
    if (cfg.options.length === 0) {
      return { ok: false, error: `${def.label}: add options before use` }
    }
    const match = cfg.options.find(
      (o) => uppercaseAsciiLetters(o) === uppercaseAsciiLetters(s)
    )
    if (!match) {
      return { ok: false, error: `${def.label}: must be one of the allowed options` }
    }
    return { ok: true, value: match }
  }
  return { ok: false, error: `Unknown field type for ${def.key}` }
}

/** Merge request fieldValues with previous row; omitted keys keep previous values; explicit empty clears. */
function mergeFieldValuesForUpdate(
  schemaId: string,
  input: Record<string, unknown> | undefined,
  prev: Record<string, unknown>
): { ok: true; merged: Record<string, string | number> } | { ok: false; error: string } {
  const defs = db
    .prepare(
      `SELECT key, label, type, config FROM location_schema_fields WHERE schema_id = ? ORDER BY order_index`
    )
    .all(schemaId) as Array<{ key: string; label: string; type: string; config: string | null }>

  const merged: Record<string, string | number> = {}
  const inputObj = input && typeof input === 'object' ? input : {}

  for (const def of defs) {
    const hasKey = Object.prototype.hasOwnProperty.call(inputObj, def.key)
    const raw = hasKey ? (inputObj as Record<string, unknown>)[def.key] : prev[def.key]
    if (raw === null || raw === undefined || raw === '') {
      continue
    }
    const n = normalizeLocationFieldValue(def, raw)
    if (!n.ok) return n
    if (n.value !== null) merged[def.key] = n.value
  }
  return { ok: true, merged }
}

/** Optional field defaults for generate: only keys present in input are applied. */
function validateFieldValuesFromInput(
  schemaId: string,
  input: Record<string, unknown> | undefined
): { ok: true; merged: Record<string, string | number> } | { ok: false; error: string } {
  const defs = db
    .prepare(
      `SELECT key, label, type, config FROM location_schema_fields WHERE schema_id = ? ORDER BY order_index`
    )
    .all(schemaId) as Array<{ key: string; label: string; type: string; config: string | null }>

  const merged: Record<string, string | number> = {}
  const inputObj = input && typeof input === 'object' ? input : {}

  for (const def of defs) {
    if (!Object.prototype.hasOwnProperty.call(inputObj, def.key)) continue
    const raw = (inputObj as Record<string, unknown>)[def.key]
    if (raw === null || raw === undefined || raw === '') continue
    const n = normalizeLocationFieldValue(def, raw)
    if (!n.ok) return n
    if (n.value !== null) merged[def.key] = n.value
  }
  return { ok: true, merged }
}

// ----- Schemas -----

router.get('/schemas', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, description, created_at as createdAt, updated_at as updatedAt
       FROM location_schemas
       ORDER BY name`
    )
    .all()
  res.json(rows)
})

router.post('/schemas', (req: AuthRequest, res) => {
  const { name, description } = req.body as {
    name?: string
    description?: string
  }
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' })
  }
  const id = uuidv4()
  db.prepare(
    `INSERT INTO location_schemas (id, name, description) VALUES (?, ?, ?)`
  ).run(id, name.trim(), description ?? null)
  const row = db
    .prepare(
      `SELECT id, name, description, created_at as createdAt, updated_at as updatedAt
       FROM location_schemas WHERE id = ?`
    )
    .get(id)
  res.status(201).json(row)
})

router.put('/schemas/:schemaId', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const existing = db
    .prepare(`SELECT id FROM location_schemas WHERE id = ?`)
    .get(schemaId) as { id: string } | undefined
  if (!existing) return res.status(404).json({ error: 'Schema not found' })

  const { name, description } = req.body as {
    name?: string
    description?: string
  }

  db.prepare(
    `UPDATE location_schemas
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name != null ? String(name).trim() : null,
    description != null ? String(description) : null,
    schemaId
  )

  const row = db
    .prepare(
      `SELECT id, name, description, created_at as createdAt, updated_at as updatedAt
       FROM location_schemas WHERE id = ?`
    )
    .get(schemaId)
  res.json(row)
})

router.delete('/schemas/:schemaId', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const zoneRows = db
    .prepare(`SELECT name FROM zones WHERE schema_id = ? ORDER BY name COLLATE NOCASE`)
    .all(schemaId) as Array<{ name: string }>
  if (zoneRows.length > 0) {
    const maxList = 12
    const names = zoneRows.map((z) => z.name)
    const shown = names.slice(0, maxList)
    const extra = names.length > maxList ? ` (+${names.length - maxList} more)` : ''
    const list = `${shown.join(', ')}${extra}`
    const n = zoneRows.length
    const zoneWord = n === 1 ? 'zone' : 'zones'
    return res.status(400).json({
      error: `Cannot delete this schema: it is still assigned to ${n} ${zoneWord} (${list}). Remove those zones or change each zone to use a different schema first.`,
    })
  }
  db.prepare(`DELETE FROM location_schema_components WHERE schema_id = ?`).run(schemaId)
  db.prepare(`DELETE FROM location_schema_fields WHERE schema_id = ?`).run(schemaId)
  db.prepare(`DELETE FROM location_schemas WHERE id = ?`).run(schemaId)
  res.status(204).end()
})

// ----- Schema components -----

router.get('/schemas/:schemaId/components', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const components = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, display_name as displayName, type, width,
              min_value as minValue, max_value as maxValue, order_index as orderIndex
       FROM location_schema_components
       WHERE schema_id = ?
       ORDER BY order_index`
    )
    .all(schemaId)
  res.json(components)
})

router.post('/schemas/:schemaId/components', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const schema = db
    .prepare(`SELECT id FROM location_schemas WHERE id = ?`)
    .get(schemaId) as { id: string } | undefined
  if (!schema) return res.status(404).json({ error: 'Schema not found' })

  const body = req.body as {
    key?: string
    displayName?: string
    type?: 'alpha' | 'numeric'
    width?: number
    minValue?: string
    maxValue?: string
  }
  if (!body.key || !body.displayName || !body.type || !body.width) {
    return res.status(400).json({ error: 'key, displayName, type, and width are required' })
  }
  const id = uuidv4()
  const maxOrder = db
    .prepare(
      `SELECT COALESCE(MAX(order_index), 0) as maxOrder FROM location_schema_components WHERE schema_id = ?`
    )
    .get(schemaId) as { maxOrder: number }
  const orderIndex = maxOrder.maxOrder + 1

  const keyStr = String(body.key).trim()
  const fieldCollision = db
    .prepare(`SELECT id FROM location_schema_fields WHERE schema_id = ? AND key = ?`)
    .get(schemaId, keyStr) as { id: string } | undefined
  if (fieldCollision) {
    return res.status(400).json({ error: `Key "${keyStr}" is already used by a schema field` })
  }

  db.prepare(
    `INSERT INTO location_schema_components
       (id, schema_id, key, display_name, type, width, min_value, max_value, order_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    schemaId,
    keyStr,
    String(body.displayName),
    String(body.type),
    Number(body.width),
    body.minValue ?? null,
    body.maxValue ?? null,
    orderIndex
  )

  const row = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, display_name as displayName, type, width,
              min_value as minValue, max_value as maxValue, order_index as orderIndex
       FROM location_schema_components WHERE id = ?`
    )
    .get(id)
  res.status(201).json(row)
})

router.put('/schemas/:schemaId/components/reorder', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const body = req.body as { orderedIds?: unknown }

  const existing = db
    .prepare(`SELECT id FROM location_schema_components WHERE schema_id = ?`)
    .all(schemaId) as Array<{ id: string }>
  const existingIds = existing.map((r) => r.id)

  const requested = Array.isArray(body.orderedIds)
    ? (body.orderedIds.filter((v) => typeof v === 'string') as string[])
    : []
  const requestedSet = new Set(requested)
  const filteredRequested = requested.filter((id) => existingIds.includes(id))
  const remaining = existingIds.filter((id) => !requestedSet.has(id))
  const finalOrder = [...filteredRequested, ...remaining]
  if (finalOrder.length === 0) {
    return res.status(400).json({ error: 'No valid schema items to reorder' })
  }

  const update = db.prepare(
    `UPDATE location_schema_components
     SET order_index = ?, updated_at = datetime('now')
     WHERE id = ? AND schema_id = ?`
  )
  for (let i = 0; i < finalOrder.length; i++) {
    update.run(i + 1, finalOrder[i], schemaId)
  }

  const components = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, display_name as displayName, type, width,
              min_value as minValue, max_value as maxValue, order_index as orderIndex
       FROM location_schema_components
       WHERE schema_id = ?
       ORDER BY order_index`
    )
    .all(schemaId)
  res.json(components)
})

router.put('/schemas/:schemaId/components/:componentId', (req: AuthRequest, res) => {
  const { schemaId, componentId } = req.params
  const existing = db
    .prepare(
      `SELECT id, schema_id as schemaId FROM location_schema_components WHERE id = ?`
    )
    .get(componentId) as { id: string; schemaId: string } | undefined
  if (!existing || existing.schemaId !== schemaId) {
    return res.status(404).json({ error: 'Schema item not found' })
  }

  const body = req.body as {
    displayName?: string
    type?: 'alpha' | 'numeric'
    width?: number
    minValue?: string | null
    maxValue?: string | null
  }

  const typeVal = body.type === 'alpha' || body.type === 'numeric' ? body.type : null
  const widthVal =
    body.width != null && Number.isFinite(Number(body.width)) ? Math.max(1, Math.min(10, Number(body.width))) : null

  db.prepare(
    `UPDATE location_schema_components
     SET display_name = COALESCE(?, display_name),
         type = COALESCE(?, type),
         width = COALESCE(?, width),
         min_value = COALESCE(?, min_value),
         max_value = COALESCE(?, max_value),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    body.displayName != null ? String(body.displayName) : null,
    typeVal,
    widthVal,
    body.minValue !== undefined ? body.minValue : null,
    body.maxValue !== undefined ? body.maxValue : null,
    componentId
  )

  const row = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, display_name as displayName, type, width,
              min_value as minValue, max_value as maxValue, order_index as orderIndex
       FROM location_schema_components WHERE id = ?`
    )
    .get(componentId)
  res.json(row)
})

router.delete('/schemas/:schemaId/components/:componentId', (req: AuthRequest, res) => {
  const { schemaId, componentId } = req.params
  const existing = db
    .prepare(`SELECT id FROM location_schema_components WHERE id = ? AND schema_id = ?`)
    .get(componentId, schemaId) as { id: string } | undefined
  if (!existing) {
    return res.status(404).json({ error: 'Schema item not found' })
  }
  db.prepare(`DELETE FROM location_schema_components WHERE id = ?`).run(componentId)
  const remaining = db
    .prepare(
      `SELECT id FROM location_schema_components WHERE schema_id = ? ORDER BY order_index`
    )
    .all(schemaId) as Array<{ id: string }>
  const update = db.prepare(
    `UPDATE location_schema_components SET order_index = ?, updated_at = datetime('now') WHERE id = ? AND schema_id = ?`
  )
  for (let i = 0; i < remaining.length; i++) {
    update.run(i + 1, remaining[i].id, schemaId)
  }
  res.status(204).end()
})

// ----- Schema custom fields (number / text / select) -----

router.get('/schemas/:schemaId/fields', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const schema = db.prepare(`SELECT id FROM location_schemas WHERE id = ?`).get(schemaId) as { id: string } | undefined
  if (!schema) return res.status(404).json({ error: 'Schema not found' })
  const rows = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, label, type, config, order_index as orderIndex,
              created_at as createdAt, updated_at as updatedAt
       FROM location_schema_fields
       WHERE schema_id = ?
       ORDER BY order_index`
    )
    .all(schemaId)
  const out = (rows as any[]).map((r) => ({
    ...r,
    config: safeParseJson(r.config as string) ?? {},
  }))
  res.json(out)
})

router.post('/schemas/:schemaId/fields', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const schema = db.prepare(`SELECT id FROM location_schemas WHERE id = ?`).get(schemaId) as { id: string } | undefined
  if (!schema) return res.status(404).json({ error: 'Schema not found' })

  const body = req.body as {
    key?: string
    label?: string
    type?: string
    config?: Record<string, unknown>
  }
  if (!body.key || !body.label || !body.type) {
    return res.status(400).json({ error: 'key, label, and type are required' })
  }
  const type = body.type as string
  if (type !== 'number' && type !== 'text' && type !== 'select') {
    return res.status(400).json({ error: 'type must be number, text, or select' })
  }
  const keyStr = String(body.key).trim()
  if (!keyStr) return res.status(400).json({ error: 'key is required' })

  const compCollision = db
    .prepare(`SELECT id FROM location_schema_components WHERE schema_id = ? AND key = ?`)
    .get(schemaId, keyStr) as { id: string } | undefined
  if (compCollision) {
    return res.status(400).json({ error: `Key "${keyStr}" is already used by a code component` })
  }

  const maxOrder = db
    .prepare(`SELECT COALESCE(MAX(order_index), 0) as maxOrder FROM location_schema_fields WHERE schema_id = ?`)
    .get(schemaId) as { maxOrder: number }
  const orderIndex = maxOrder.maxOrder + 1
  const id = uuidv4()
  const configJson =
    body.config && typeof body.config === 'object'
      ? JSON.stringify(
          type === 'select'
            ? normalizeSelectFieldConfig(body.config as Record<string, unknown>)
            : body.config
        )
      : null

  try {
    db.prepare(
      `INSERT INTO location_schema_fields (id, schema_id, key, label, type, config, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, schemaId, keyStr, String(body.label).trim(), type, configJson, orderIndex)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A field with this key already exists for this schema' })
    }
    throw e
  }

  const row = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, label, type, config, order_index as orderIndex,
              created_at as createdAt, updated_at as updatedAt
       FROM location_schema_fields WHERE id = ?`
    )
    .get(id) as Record<string, unknown>
  res.status(201).json({
    ...row,
    config: safeParseJson(row.config as string) ?? {},
  })
})

router.put('/schemas/:schemaId/fields/reorder', (req: AuthRequest, res) => {
  const { schemaId } = req.params
  const schema = db.prepare(`SELECT id FROM location_schemas WHERE id = ?`).get(schemaId) as { id: string } | undefined
  if (!schema) return res.status(404).json({ error: 'Schema not found' })

  const body = req.body as { orderedIds?: unknown }
  const existing = db
    .prepare(`SELECT id FROM location_schema_fields WHERE schema_id = ?`)
    .all(schemaId) as Array<{ id: string }>
  const existingIds = existing.map((r) => r.id)

  const requested = Array.isArray(body.orderedIds)
    ? (body.orderedIds.filter((v) => typeof v === 'string') as string[])
    : []
  const requestedSet = new Set(requested)
  const filteredRequested = requested.filter((id) => existingIds.includes(id))
  const remaining = existingIds.filter((id) => !requestedSet.has(id))
  const finalOrder = [...filteredRequested, ...remaining]
  if (finalOrder.length === 0) {
    return res.status(400).json({ error: 'No valid fields to reorder' })
  }

  const update = db.prepare(
    `UPDATE location_schema_fields
     SET order_index = ?, updated_at = datetime('now')
     WHERE id = ? AND schema_id = ?`
  )
  for (let i = 0; i < finalOrder.length; i++) {
    update.run(i + 1, finalOrder[i], schemaId)
  }

  const rows = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, label, type, config, order_index as orderIndex,
              created_at as createdAt, updated_at as updatedAt
       FROM location_schema_fields
       WHERE schema_id = ?
       ORDER BY order_index`
    )
    .all(schemaId)
  const out = (rows as any[]).map((r) => ({
    ...r,
    config: safeParseJson(r.config as string) ?? {},
  }))
  res.json(out)
})

router.put('/schemas/:schemaId/fields/:fieldId', (req: AuthRequest, res) => {
  const { schemaId, fieldId } = req.params
  const existing = db
    .prepare(`SELECT id, schema_id as schemaId FROM location_schema_fields WHERE id = ?`)
    .get(fieldId) as { id: string; schemaId: string } | undefined
  if (!existing || existing.schemaId !== schemaId) {
    return res.status(404).json({ error: 'Field not found' })
  }

  const body = req.body as {
    label?: string
    type?: string
    config?: Record<string, unknown> | null
  }

  const typeVal =
    body.type === 'number' || body.type === 'text' || body.type === 'select' ? body.type : null

  const cur = db
    .prepare(`SELECT label, type, config FROM location_schema_fields WHERE id = ?`)
    .get(fieldId) as { label: string; type: string; config: string | null }

  const newLabel = body.label !== undefined ? String(body.label).trim() : cur.label
  const newType = typeVal ?? cur.type
  const newConfig =
    body.config !== undefined
      ? body.config && typeof body.config === 'object'
        ? JSON.stringify(
            newType === 'select'
              ? normalizeSelectFieldConfig(body.config as Record<string, unknown>)
              : body.config
          )
        : null
      : cur.config

  db.prepare(
    `UPDATE location_schema_fields
     SET label = ?, type = ?, config = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(newLabel, newType, newConfig, fieldId)

  const row = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, label, type, config, order_index as orderIndex,
              created_at as createdAt, updated_at as updatedAt
       FROM location_schema_fields WHERE id = ?`
    )
    .get(fieldId) as Record<string, unknown>
  res.json({
    ...row,
    config: safeParseJson(row.config as string) ?? {},
  })
})

router.delete('/schemas/:schemaId/fields/:fieldId', (req: AuthRequest, res) => {
  const { schemaId, fieldId } = req.params
  const existing = db
    .prepare(`SELECT id FROM location_schema_fields WHERE id = ? AND schema_id = ?`)
    .get(fieldId, schemaId) as { id: string } | undefined
  if (!existing) return res.status(404).json({ error: 'Field not found' })
  db.prepare(`DELETE FROM location_schema_fields WHERE id = ?`).run(fieldId)
  res.status(204).end()
})

// ----- Zones -----

router.get('/zones', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT z.id,
              z.name,
              z.description,
              z.schema_id as schemaId,
              s.name as schemaName,
              z.created_at as createdAt,
              z.updated_at as updatedAt,
              (SELECT COUNT(*) FROM locations l WHERE l.zone_id = z.id) as locationCount
       FROM zones z
       JOIN location_schemas s ON s.id = z.schema_id
       ORDER BY z.name`
    )
    .all()
  res.json(rows)
})

router.post('/zones', (req: AuthRequest, res) => {
  const { name, description, schemaId } = req.body as {
    name?: string
    description?: string
    schemaId?: string
  }
  if (!name || !schemaId) {
    return res.status(400).json({ error: 'name and schemaId are required' })
  }
  const schema = db
    .prepare(`SELECT id FROM location_schemas WHERE id = ?`)
    .get(schemaId) as { id: string } | undefined
  if (!schema) return res.status(400).json({ error: 'Invalid schemaId' })
  const id = uuidv4()
  db.prepare(
    `INSERT INTO zones (id, name, description, schema_id)
     VALUES (?, ?, ?, ?)`
  ).run(id, name.trim(), description ?? null, schemaId)

  const row = db
    .prepare(
      `SELECT z.id,
              z.name,
              z.description,
              z.schema_id as schemaId,
              s.name as schemaName,
              z.created_at as createdAt,
              z.updated_at as updatedAt,
              (SELECT COUNT(*) FROM locations l WHERE l.zone_id = z.id) as locationCount
       FROM zones z
       JOIN location_schemas s ON s.id = z.schema_id
       WHERE z.id = ?`
    )
    .get(id)
  res.status(201).json(row)
})

router.put('/zones/:zoneId', (req: AuthRequest, res) => {
  const { zoneId } = req.params
  const existing = db
    .prepare(`SELECT id FROM zones WHERE id = ?`)
    .get(zoneId) as { id: string } | undefined
  if (!existing) return res.status(404).json({ error: 'Zone not found' })

  const { name, description } = req.body as { name?: string; description?: string }
  db.prepare(
    `UPDATE zones
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(name != null ? String(name).trim() : null, description ?? null, zoneId)

  const row = db
    .prepare(
      `SELECT z.id,
              z.name,
              z.description,
              z.schema_id as schemaId,
              s.name as schemaName,
              z.created_at as createdAt,
              z.updated_at as updatedAt,
              (SELECT COUNT(*) FROM locations l WHERE l.zone_id = z.id) as locationCount
       FROM zones z
       JOIN location_schemas s ON s.id = z.schema_id
       WHERE z.id = ?`
    )
    .get(zoneId)
  res.json(row)
})

router.delete('/zones/:zoneId', (req: AuthRequest, res) => {
  const { zoneId } = req.params
  db.prepare(`DELETE FROM locations WHERE zone_id = ?`).run(zoneId)
  db.prepare(`DELETE FROM zones WHERE id = ?`).run(zoneId)
  res.status(204).end()
})

// ----- Locations: list & generate -----

router.get('/zones/:zoneId/locations', (req: AuthRequest, res) => {
  const { zoneId } = req.params
  const zone = db
    .prepare(`SELECT id, schema_id as schemaId, name FROM zones WHERE id = ?`)
    .get(zoneId) as { id: string; schemaId: string; name: string } | undefined
  if (!zone) return res.status(404).json({ error: 'Zone not found' })

  const rows = db
    .prepare(
      `SELECT id, schema_id as schemaId, zone_id as zoneId, code, components, field_values, created_at as createdAt, updated_at as updatedAt
       FROM locations
       WHERE zone_id = ?
       ORDER BY code`
    )
    .all(zoneId)
  const out = rows.map((r: any) => ({
    ...r,
    components: safeParseJson(r.components),
    fieldValues: safeParseJson(r.field_values) ?? {},
  }))
  for (const r of out as any[]) {
    delete r.field_values
  }

  const format = (req.query.format as string | undefined) ?? 'json'
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    const csvName = `${sanitizeFilenameSegment(zone.name)}-locations.csv`
    res.setHeader('Content-Disposition', `attachment; filename="${csvName}"`)
    const lines: string[] = []
    // Header: code plus schema component keys in schema order, then custom field keys
    const schemaComponents = db
      .prepare(
        `SELECT key
         FROM location_schema_components
         WHERE schema_id = ?
         ORDER BY order_index`
      )
      .all(zone.schemaId) as Array<{ key: string }>
    const componentKeys = schemaComponents.map((r) => r.key)
    const schemaFieldKeys = db
      .prepare(
        `SELECT key FROM location_schema_fields WHERE schema_id = ? ORDER BY order_index`
      )
      .all(zone.schemaId) as Array<{ key: string }>
    const fieldKeys = schemaFieldKeys.map((r) => r.key)
    lines.push(['code', ...componentKeys, ...fieldKeys].join(','))
    for (const row of out as any[]) {
      const comps = (row.components || {}) as Record<string, unknown>
      const fvs = (row.fieldValues || {}) as Record<string, unknown>
      const compVals = componentKeys.map((k) => String(comps[k] ?? ''))
      const fieldVals = fieldKeys.map((k) => {
        const v = fvs[k]
        if (v === null || v === undefined) return ''
        return String(v)
      })
      lines.push([row.code, ...compVals, ...fieldVals].join(','))
    }
    res.send(lines.join('\n'))
    return
  }

  res.json(out)
})

/** Delete many locations in this zone in one round-trip (batched SQL; avoids N sequential HTTP deletes). */
router.post('/zones/:zoneId/locations/bulk-delete', (req: AuthRequest, res) => {
  const { zoneId } = req.params
  const zone = db.prepare(`SELECT id FROM zones WHERE id = ?`).get(zoneId) as { id: string } | undefined
  if (!zone) return res.status(404).json({ error: 'Zone not found' })

  const body = req.body as { ids?: unknown }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (ids.length === 0) return res.status(400).json({ error: 'Provide a non-empty ids array' })

  const MAX_IDS = 100_000
  if (ids.length > MAX_IDS) {
    return res.status(400).json({ error: `At most ${MAX_IDS.toLocaleString()} ids per request` })
  }

  const chunkSize = 400
  let deleted = 0
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const ph = chunk.map(() => '?').join(',')
    const info = db
      .prepare(`DELETE FROM locations WHERE zone_id = ? AND id IN (${ph})`)
      .run(zoneId, ...chunk)
    deleted += info.changes
  }

  res.json({ deleted })
})

router.put('/zones/:zoneId/locations/:locationId', (req: AuthRequest, res) => {
  const { zoneId, locationId } = req.params
  const zone = db
    .prepare(`SELECT id, schema_id as schemaId FROM zones WHERE id = ?`)
    .get(zoneId) as { id: string; schemaId: string } | undefined
  if (!zone) return res.status(404).json({ error: 'Zone not found' })

  const existing = db
    .prepare(
      `SELECT id, zone_id as zoneId, components, field_values FROM locations WHERE id = ?`
    )
    .get(locationId) as {
    id: string
    zoneId: string
    components: string | null
    field_values: string | null
  } | undefined
  if (!existing || existing.zoneId !== zoneId) {
    return res.status(404).json({ error: 'Location not found' })
  }

  const schemaComponents = db
    .prepare(
      `SELECT key, display_name as displayName, type, width
       FROM location_schema_components
       WHERE schema_id = ?
       ORDER BY order_index`
    )
    .all(zone.schemaId) as Array<{
      key: string
      displayName: string
      type: 'alpha' | 'numeric'
      width: number
    }>

  if (schemaComponents.length === 0) {
    return res.status(400).json({ error: 'Schema has no components defined' })
  }

  const body = req.body as { components?: Record<string, unknown>; fieldValues?: Record<string, unknown> }
  const input = (body.components && typeof body.components === 'object' ? body.components : {}) as Record<
    string,
    unknown
  >
  const prevComps = (safeParseJson(existing.components) as Record<string, string> | null) ?? {}
  const prevFieldVals = (safeParseJson(existing.field_values) as Record<string, unknown> | null) ?? {}

  const mergedFv = mergeFieldValuesForUpdate(zone.schemaId, body.fieldValues, prevFieldVals)
  if (!mergedFv.ok) {
    return res.status(400).json({ error: mergedFv.error })
  }

  const next: Record<string, string> = {}
  for (const comp of schemaComponents) {
    const raw =
      input[comp.key] !== undefined ? input[comp.key] : prevComps[comp.key]
    const s = raw != null ? String(raw).trim() : ''
    if (!s) {
      return res.status(400).json({ error: `Missing value for ${comp.displayName} (${comp.key})` })
    }
    if (comp.type === 'numeric') {
      if (!/^\d+$/.test(s)) {
        return res.status(400).json({ error: `${comp.displayName}: use digits only (0–9)` })
      }
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return res.status(400).json({ error: `Invalid number for ${comp.displayName}` })
      }
      const padded = String(Math.trunc(n)).padStart(comp.width, '0')
      if (padded.length > comp.width) {
        return res.status(400).json({
          error: `${comp.displayName} must fit within ${comp.width} digit(s)`,
        })
      }
      next[comp.key] = padded
    } else {
      if (!/^[A-Za-z]+$/.test(s)) {
        return res.status(400).json({ error: `${comp.displayName}: use letters A–Z only` })
      }
      if (s.length > comp.width) {
        return res.status(400).json({
          error: `${comp.displayName} must be at most ${comp.width} letter(s)`,
        })
      }
      next[comp.key] = s.toUpperCase()
    }
  }

  const code = schemaComponents.map((c) => next[c.key]).join('')

  const conflict = db
    .prepare(`SELECT id FROM locations WHERE code = ? AND id != ?`)
    .get(code, locationId) as { id: string } | undefined
  if (conflict) {
    return res.status(409).json({ error: 'Another location already uses this code' })
  }

  const fvJson =
    Object.keys(mergedFv.merged).length > 0 ? JSON.stringify(mergedFv.merged) : null

  db.prepare(
    `UPDATE locations
     SET code = ?, components = ?, field_values = ?, updated_at = datetime('now')
     WHERE id = ? AND zone_id = ?`
  ).run(code, JSON.stringify(next), fvJson, locationId, zoneId)

  const row = db
    .prepare(
      `SELECT id, schema_id as schemaId, zone_id as zoneId, code, components, field_values, created_at as createdAt, updated_at as updatedAt
       FROM locations WHERE id = ?`
    )
    .get(locationId) as any
  const { field_values: _omitFv, ...rowOut } = row as any
  res.json({
    ...rowOut,
    components: safeParseJson(row.components),
    fieldValues: safeParseJson(row.field_values) ?? {},
  })
})

router.delete('/zones/:zoneId/locations/:locationId', (req: AuthRequest, res) => {
  const { zoneId, locationId } = req.params
  const existing = db
    .prepare(`SELECT id, zone_id as zoneId FROM locations WHERE id = ?`)
    .get(locationId) as { id: string; zoneId: string } | undefined
  if (!existing || existing.zoneId !== zoneId) {
    return res.status(404).json({ error: 'Location not found' })
  }
  db.prepare(`DELETE FROM locations WHERE id = ?`).run(locationId)
  res.status(204).end()
})

function safeParseJson(val: string | null): unknown {
  if (!val) return null
  try {
    return JSON.parse(val)
  } catch {
    return null
  }
}

interface SchemaComponent {
  id: string
  schemaId: string
  key: string
  displayName: string
  type: 'alpha' | 'numeric'
  width: number
  minValue: string | null
  maxValue: string | null
  orderIndex: number
}

// Expand range expressions like "1-3,5" or "A-C,Z" — must match src/utils/expandLocationGenerationRange.ts
function expandRange(
  expr: string,
  type: 'alpha' | 'numeric',
  width: number
): { values: string[]; error?: string } {
  const trimmed = expr.trim()
  if (!trimmed) return { values: [] }

  const parts = trimmed
    .split(/[;,]+/g)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []

  function alphaRangeCartesian(
    startRaw: string,
    endRaw: string
  ): { values: string[]; error?: string } {
    const start = startRaw.toUpperCase()
    const end = endRaw.toUpperCase()
    if (start.length !== end.length) {
      return { values: [], error: `Range ends must match length (${startRaw}–${endRaw})` }
    }
    if (start.length !== width) {
      return { values: [], error: `Range must be exactly ${width} letter(s) for this part` }
    }
    const cols: string[][] = []
    for (let i = 0; i < start.length; i++) {
      const a = start.charCodeAt(i)
      const b = end.charCodeAt(i)
      if (a < 65 || a > 90 || b < 65 || b > 90) {
        return { values: [], error: `Use letters A–Z at each position` }
      }
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const col: string[] = []
      for (let c = lo; c <= hi; c++) {
        col.push(String.fromCharCode(c))
      }
      cols.push(col)
    }
    function cartesian(c: string[][]): string[] {
      if (c.length === 0) return ['']
      const [head, ...tail] = c
      const rest = cartesian(tail)
      const acc: string[] = []
      for (const ch of head) {
        for (const s of rest) {
          acc.push(ch + s)
        }
      }
      return acc
    }
    return { values: cartesian(cols) }
  }

  for (const part of parts) {
    const m = part.match(/^([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)$/)
    if (m) {
      const start = m[1]
      const end = m[2]
      if (type === 'numeric') {
        const a = parseInt(start, 10)
        const b = parseInt(end, 10)
        if (Number.isNaN(a) || Number.isNaN(b)) {
          return { values: [], error: `Invalid numeric range: ${part}` }
        }
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        for (let n = lo; n <= hi; n++) {
          if (!Number.isInteger(n) || n < 0) {
            return { values: [], error: `Invalid number in range: ${n}` }
          }
          const padded = String(n).padStart(width, '0')
          if (padded.length !== width) {
            return { values: [], error: `Value ${n} does not fit in ${width} digit(s)` }
          }
          out.push(padded)
        }
      } else {
        if (width >= 2 && start.length === 1 && end.length === 1) {
          return {
            values: [],
            error: `Use ${width} letters on each side (e.g. AA–BB), not single letters like ${part}`,
          }
        }
        if (start.length === 1 && end.length === 1) {
          const a = start.toUpperCase().charCodeAt(0)
          const b = end.toUpperCase().charCodeAt(0)
          if (a < 65 || a > 90 || b < 65 || b > 90) {
            return { values: [], error: `Use letters A–Z in range: ${part}` }
          }
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          for (let c = lo; c <= hi; c++) {
            const ch = String.fromCharCode(c)
            out.push(ch.padStart(width, 'A'))
          }
        } else {
          const expanded = alphaRangeCartesian(start, end)
          if (expanded.error) {
            return { values: [], error: expanded.error }
          }
          out.push(...expanded.values)
        }
      }
      continue
    }

    if (type === 'numeric') {
      const n = parseInt(part, 10)
      if (Number.isNaN(n)) {
        return { values: [], error: `Invalid number: ${part}` }
      }
      if (!Number.isInteger(n) || n < 0) {
        return { values: [], error: `Invalid number: ${part}` }
      }
      const padded = String(n).padStart(width, '0')
      if (padded.length !== width) {
        return { values: [], error: `Value ${n} does not fit in ${width} digit(s)` }
      }
      out.push(padded)
    } else {
      const letters = uppercaseAsciiLetters(part)
        .replace(/[^A-Za-z]/g, '')
        .toUpperCase()
      if (!letters) {
        return { values: [], error: `Invalid letters: ${part}` }
      }
      if (letters.length > width) {
        return { values: [], error: `Use at most ${width} letter(s) in ${part}` }
      }
      if (!/^[A-Z]+$/.test(letters)) {
        return { values: [], error: `Use letters A–Z only: ${part}` }
      }
      if (width >= 2 && letters.length < width) {
        return {
          values: [],
          error: `Each value must be exactly ${width} letters (e.g. HH not H): ${part}`,
        }
      }
      out.push(letters.padStart(width, 'A'))
    }
  }

  return { values: Array.from(new Set(out)) }
}

/** Yield so Node can flush streamed `res.write` chunks; long sync loops starve the event loop. */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

router.post('/zones/:zoneId/locations/generate', async (req: AuthRequest, res) => {
  try {
  const { zoneId } = req.params
  const zone = db
    .prepare(`SELECT id, schema_id as schemaId FROM zones WHERE id = ?`)
    .get(zoneId) as { id: string; schemaId: string } | undefined
  if (!zone) return res.status(404).json({ error: 'Zone not found' })

  const components = db
    .prepare(
      `SELECT id, schema_id as schemaId, key, display_name as displayName, type, width,
              min_value as minValue, max_value as maxValue, order_index as orderIndex
       FROM location_schema_components
       WHERE schema_id = ?
       ORDER BY order_index`
    )
    .all(zone.schemaId) as unknown as SchemaComponent[]

  if (components.length === 0) {
    return res.status(400).json({ error: 'Schema has no components defined' })
  }

  const rangesInput = (req.body?.components ?? {}) as Record<string, string>
  const fieldValsResult = validateFieldValuesFromInput(
    zone.schemaId,
    (req.body as { fieldValues?: Record<string, unknown> }).fieldValues
  )
  if (!fieldValsResult.ok) {
    return res.status(400).json({ error: fieldValsResult.error })
  }
  const optionalFieldValuesJson =
    Object.keys(fieldValsResult.merged).length > 0 ? JSON.stringify(fieldValsResult.merged) : null

  const expandedPerKey = new Map<string, string[]>()
  for (const comp of components) {
    const raw = (rangesInput[comp.key] ?? '').trim()
    if (!raw) {
      return res.status(400).json({ error: `Missing range for component ${comp.displayName}` })
    }
    const expanded = expandRange(raw, comp.type, comp.width)
    if (expanded.error) {
      return res.status(400).json({ error: `${comp.displayName}: ${expanded.error}` })
    }
    if (expanded.values.length === 0) {
      return res.status(400).json({ error: `No values produced for component ${comp.displayName}` })
    }
    expandedPerKey.set(comp.key, expanded.values)
  }

  // Build cartesian product with a simple recursive generator
  const keys = components.map((c) => c.key)
  const rows: Record<string, string>[] = []

  function build(idx: number, acc: Record<string, string>) {
    if (idx >= keys.length) {
      rows.push({ ...acc })
      return
    }
    const key = keys[idx]
    const values = expandedPerKey.get(key) ?? []
    for (const v of values) {
      acc[key] = v
      build(idx + 1, acc)
    }
  }

  build(0, {})

  const maxRows = getMaxGenerateRows()
  if (rows.length > maxRows) {
    return res.status(400).json({
      error: `Too many locations to generate (${rows.length.toLocaleString()}). Maximum is ${maxRows.toLocaleString()}. Narrow your ranges, or set LOCATION_GENERATE_MAX_ROWS on the server (cap ${ABSOLUTE_MAX_GENERATE_ROWS.toLocaleString()}).`,
    })
  }

  const streamProgress =
    req.query.stream === '1' ||
    req.query.stream === 'true' ||
    String(req.query.stream ?? '').toLowerCase() === 'yes'

  if (streamProgress) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
  }

  let created = 0
  let skipped = 0

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO locations (id, schema_id, zone_id, code, components, field_values)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  const totalRows = rows.length
  const progressEvery = Math.max(1, Math.ceil(totalRows / 200))

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const id = uuidv4()
    const code = components.map((c) => r[c.key]).join('')
    const result = insertStmt.run(
      id,
      zone.schemaId,
      zoneId,
      code,
      JSON.stringify(r),
      optionalFieldValuesJson
    )
    if (((result as { changes?: number }).changes ?? 0) > 0) created++
    else skipped++

    if (
      streamProgress &&
      ((i + 1) % progressEvery === 0 || i === rows.length - 1)
    ) {
      res.write(
        JSON.stringify({ type: 'progress', processed: i + 1, total: totalRows }) + '\n'
      )
      await yieldEventLoop()
    }
  }

  if (streamProgress) {
    res.write(
      JSON.stringify({
        type: 'complete',
        created,
        skipped,
        totalRequested: totalRows,
      }) + '\n'
    )
    await yieldEventLoop()
    res.end()
  } else {
    res.json({ created, skipped, totalRequested: totalRows })
  }
  } catch (err) {
    console.error('[locations/generate]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate locations' })
    } else {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
  }
})

// Export all locations for selected zones as CSV (simple aggregate).
router.get('/export', (req: AuthRequest, res) => {
  const idsParam = (req.query.zoneIds as string | undefined) ?? ''
  const zoneIds = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (zoneIds.length === 0) {
    return res.status(400).json({ error: 'zoneIds query parameter is required' })
  }

  const placeholders = zoneIds.map(() => '?').join(',')
  const zoneMeta = db
    .prepare(`SELECT id, name FROM zones WHERE id IN (${placeholders})`)
    .all(...zoneIds) as Array<{ id: string; name: string }>
  const nameById = new Map(zoneMeta.map((z) => [z.id, z.name]))
  const exportFilename = buildMultiZoneExportFilename(zoneIds, nameById)

  const rows = db
    .prepare(
      `SELECT l.code,
              l.components,
              z.name as zoneName,
              z.id as zoneId
       FROM locations l
       JOIN zones z ON z.id = l.zone_id
       WHERE l.zone_id IN (${placeholders})
       ORDER BY z.name, l.code`
    )
    .all(...zoneIds) as Array<{
      code: string
      components: string | null
      zoneName: string
      zoneId: string
    }>

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename}"`)

  if (rows.length === 0) {
    res.send('zoneName,zoneId,code\n')
    return
  }

  // Use schema order. If multiple schemas are included, union keys in a stable order:
  // first by schema's order_index, then remaining keys alphabetically.
  const zoneSchemas = db
    .prepare(
      `SELECT id as zoneId, schema_id as schemaId
       FROM zones
       WHERE id IN (${placeholders})`
    )
    .all(...zoneIds) as Array<{ zoneId: string; schemaId: string }>
  const schemaIds = Array.from(new Set(zoneSchemas.map((z) => z.schemaId)))
  const schemaKeyRows = schemaIds.length
    ? (db
        .prepare(
          `SELECT schema_id as schemaId, key, order_index as orderIndex
           FROM location_schema_components
           WHERE schema_id IN (${schemaIds.map(() => '?').join(',')})
           ORDER BY schema_id, order_index`
        )
        .all(...schemaIds) as Array<{ schemaId: string; key: string; orderIndex: number }>)
    : []
  const orderedKeys: string[] = []
  for (const r of schemaKeyRows) {
    if (!orderedKeys.includes(r.key)) orderedKeys.push(r.key)
  }
  // Include any keys present in data but not in schema definitions.
  const discovered = new Set<string>()
  for (const r of rows) {
    const comps = safeParseJson(r.components) as Record<string, unknown> | null
    if (!comps) continue
    for (const k of Object.keys(comps)) discovered.add(k)
  }
  const extras = Array.from(discovered).filter((k) => !orderedKeys.includes(k)).sort()
  const componentKeys = [...orderedKeys, ...extras]
  const header = ['zoneName', 'zoneId', 'code', ...componentKeys].join(',')
  const lines: string[] = [header]
  for (const r of rows) {
    const comps = (safeParseJson(r.components) || {}) as Record<string, unknown>
    const vals = componentKeys.map((k) => String(comps[k] ?? ''))
    lines.push([r.zoneName, r.zoneId, r.code, ...vals].join(','))
  }
  res.send(lines.join('\n'))
})

export { router as locationsRouter }

