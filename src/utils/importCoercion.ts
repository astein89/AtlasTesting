import { parse } from 'date-fns'
import type { DataField } from '../types'

export type CoercedValue = string | number | boolean | string[] | undefined

/**
 * Coerce a string from an import file to the value expected for the field type.
 * Returns undefined when empty or invalid so the caller can use plan default or omit.
 */
export function coerceCell(value: string, field: DataField): CoercedValue {
  const trimmed = (value ?? '').trim()
  const empty = trimmed === ''

  if (field.type === 'text' || field.type === 'longtext') {
    return empty ? undefined : trimmed
  }

  if (field.type === 'number' || field.type === 'fraction' || field.type === 'weight') {
    if (empty) return undefined
    const num = parseFloat(trimmed.replace(/,/g, ''))
    return Number.isNaN(num) ? undefined : num
  }

  if (field.type === 'boolean') {
    if (empty) return undefined
    const lower = trimmed.toLowerCase()
    if (['true', '1', 'yes'].includes(lower)) return true
    if (['false', '0', 'no'].includes(lower)) return false
    return undefined
  }

  if (field.type === 'datetime') {
    if (empty) return undefined
    const iso = tryParseToIso(trimmed)
    return iso ?? undefined
  }

  if (field.type === 'select' || field.type === 'radio_select' || field.type === 'status') {
    return empty ? undefined : trimmed
  }

  if (field.type === 'checkbox_select') {
    if (empty) return undefined
    const opts = field.config?.options ?? []
    const set = new Set(opts.map(String))
    const parts = trimmed.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
    const valid = parts.filter((p) => set.has(p))
    return valid.length > 0 ? valid : undefined
  }

  if (field.type === 'formula') {
    return undefined
  }

  // image, timer, atlas_location: prefer "Don't map" in v1; if mapped as text, pass through
  if (field.type === 'atlas_location') {
    return empty ? undefined : trimmed
  }

  return empty ? undefined : trimmed
}

/** Try common date formats and return ISO string or null */
function tryParseToIso(value: string): string | null {
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  const formats = [
    'yyyy-MM-dd',
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd HH:mm:ss',
    'MM/dd/yyyy',
    'MM/dd/yyyy HH:mm',
    'dd/MM/yyyy',
    'dd/MM/yyyy HH:mm',
  ]
  for (const fmt of formats) {
    try {
      const d = parse(value, fmt, new Date())
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    } catch {
      // continue
    }
  }
  return null
}

/**
 * Parse a string as a date for use as record recordedAt (API expects ISO string).
 * Returns undefined if empty/invalid so server can use "now".
 */
export function coerceRecordedAt(value: string): string | undefined {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return undefined
  const iso = tryParseToIso(trimmed)
  return iso ?? undefined
}
