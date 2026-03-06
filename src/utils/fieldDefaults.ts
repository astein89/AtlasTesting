import type { DataField, TimerValue } from '../types'
import { getStatusOptions } from '../types'

/**
 * Returns the default value for a single field, using plan fieldDefaults when present and valid.
 * Used by Live preview and by getDefaultData when building full record defaults.
 */
export function getDefaultValueForField(
  field: DataField,
  fieldDefaults?: Record<string, string | number | boolean | string[] | TimerValue> | null
): string | number | boolean | string[] | TimerValue {
  const planDefault = fieldDefaults?.[field.key]
  if (planDefault !== undefined && planDefault !== null) {
    if (field.type === 'number' && (typeof planDefault === 'number' || planDefault === ''))
      return planDefault
    if (field.type === 'boolean' && typeof planDefault === 'boolean') return planDefault
    if (field.type === 'select' && typeof planDefault === 'string') return planDefault
    if (field.type === 'status' && typeof planDefault === 'string') return planDefault
    if ((field.type === 'text' || field.type === 'longtext') && typeof planDefault === 'string')
      return planDefault
    if (field.type === 'fraction' && typeof planDefault === 'number') return planDefault
    if (field.type === 'atlas_location' && typeof planDefault === 'string') return planDefault
    if (field.type === 'image') {
      if (Array.isArray(planDefault)) return planDefault
      if (planDefault === '') return field.config?.imageMultiple ? [] : ''
    }
    if (field.type === 'timer' && planDefault && typeof planDefault === 'object' && 'totalElapsedMs' in planDefault) {
      const t = planDefault as { totalElapsedMs?: number; startedAt?: string }
      if (typeof t.totalElapsedMs === 'number' && t.totalElapsedMs >= 0) {
        return { totalElapsedMs: t.totalElapsedMs, startedAt: typeof t.startedAt === 'string' ? t.startedAt : undefined }
      }
    }
    return typeof planDefault === 'string' ? planDefault : String(planDefault)
  }
  // No plan default: use type fallbacks
  if (field.type === 'number') return ''
  if (field.type === 'fraction') return 0
  if (field.type === 'boolean') return false
  if (field.type === 'longtext') return ''
  if (field.type === 'select') return ''
  if (field.type === 'status') {
    const opts = getStatusOptions(field)
    return opts[0] ?? 'In Progress'
  }
  if (field.type === 'atlas_location') return ''
  if (field.type === 'image') return field.config?.imageMultiple ? [] : ''
  if (field.type === 'timer') return { totalElapsedMs: 0 }
  return ''
}
