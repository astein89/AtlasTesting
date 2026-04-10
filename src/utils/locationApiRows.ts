/** Normalize location API rows: PostgreSQL returns lowercase keys for unquoted AS aliases; SQLite keeps camelCase. */

function pick<T>(r: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (k in r && r[k] !== undefined) return r[k] as T
  }
  return undefined
}

export interface NormalizedLocationSchemaComponent {
  id: string
  schemaId: string
  key: string
  displayName: string
  type: 'alpha' | 'numeric' | 'mixed' | 'fixed'
  width: number
  patternMask?: string | null
  minValue?: string | null
  orderIndex?: number
}

export function normalizeLocationSchemaComponent(
  c: NormalizedLocationSchemaComponent | Record<string, unknown>
): NormalizedLocationSchemaComponent {
  const r = c as Record<string, unknown>
  const typeVal = pick<string | undefined>(r, 'componentType', 'componenttype', 'type', 'Type')
  const lowered = typeof typeVal === 'string' ? typeVal.trim().toLowerCase() : ''
  let normalized: 'alpha' | 'numeric' | 'mixed' | 'fixed' | undefined
  if (lowered === 'mix' || lowered === 'mixed') normalized = 'mixed'
  else if (lowered === 'alpha' || lowered === 'numeric' || lowered === 'fixed') normalized = lowered
  const pm = pick(r, 'patternMask', 'pattern_mask', 'patternmask')
  const mv = pick(r, 'minValue', 'min_value', 'minvalue')
  const patternMask =
    pm != null && String(pm).trim() !== '' ? String(pm).trim() : null
  const minValue =
    mv != null && String(mv).trim() !== '' ? String(mv).trim() : null
  const id = String(pick(r, 'id') ?? '')
  const schemaId = String(pick(r, 'schemaId', 'schema_id', 'schemaid') ?? '')
  const key = String(pick(r, 'key') ?? '')
  const displayName = String(pick(r, 'displayName', 'display_name', 'displayname') ?? '')
  const widthRaw = pick(r, 'width')
  const widthNum = Number(widthRaw)
  const width = Number.isFinite(widthNum) ? widthNum : 1
  const orderRaw = pick(r, 'orderIndex', 'order_index', 'orderindex')
  const orderNum = orderRaw != null ? Number(orderRaw) : undefined
  const orderIndex = orderNum != null && Number.isFinite(orderNum) ? orderNum : undefined

  return {
    id,
    schemaId,
    key,
    displayName,
    type: (normalized ?? typeVal) as NormalizedLocationSchemaComponent['type'],
    width,
    patternMask,
    minValue,
    orderIndex,
  }
}

export interface NormalizedLocationZone {
  id: string
  name: string
  description?: string | null
  schemaId: string
  schemaName: string
  locationCount: number
}

export function normalizeLocationZone(row: Record<string, unknown>): NormalizedLocationZone {
  const countRaw = pick(row, 'locationCount', 'location_count', 'locationcount')
  const countNum = Number(countRaw)
  const locationCount = Number.isFinite(countNum) ? countNum : 0
  return {
    id: String(pick(row, 'id') ?? ''),
    name: String(pick(row, 'name') ?? ''),
    description: (pick(row, 'description') as string | null | undefined) ?? null,
    schemaId: String(pick(row, 'schemaId', 'schema_id', 'schemaid') ?? ''),
    schemaName: String(pick(row, 'schemaName', 'schema_name', 'schemaname') ?? ''),
    locationCount,
  }
}
