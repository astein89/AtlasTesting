import type { DataField, TimerValue } from '../types'

export interface FieldValidationError {
  fieldKey: string
  message: string
}

function isEmpty(
  val: string | number | boolean | string[] | TimerValue | undefined | null,
  fieldType: string
): boolean {
  if (val === undefined || val === null) return true
  if (typeof val === 'string') return val.trim() === ''
  if (typeof val === 'number') return Number.isNaN(val)
  if (typeof val === 'boolean') return false
  if (Array.isArray(val)) return val.length === 0
  if (typeof val === 'object' && val !== null && 'totalElapsedMs' in val) {
    const t = val as TimerValue
    return t.totalElapsedMs === 0 && !t.startedAt
  }
  return true
}

/**
 * Returns validation errors for record data (required, minLength/maxLength for text/longtext).
 * Empty array if valid.
 * @param requiredFieldIds - optional plan-level required field ids (by field id)
 */
export function getFieldValidationErrors(
  fields: DataField[],
  data: Record<string, string | number | boolean | string[] | TimerValue>,
  options?: { requiredFieldIds?: string[]; overrideValidation?: boolean }
): FieldValidationError[] {
  const errors: FieldValidationError[] = []
  const requiredIds = new Set(options?.requiredFieldIds ?? [])
  for (const f of fields) {
    if (f.type === 'formula') continue
    const isRequired = f.config?.required === true || requiredIds.has(f.id)
    const val = data[f.key]
    if (isRequired && isEmpty(val, f.type) && !options?.overrideValidation) {
      errors.push({ fieldKey: f.key, message: 'Required' })
    }
    if (f.type !== 'text' && f.type !== 'longtext') continue
    if (options?.overrideValidation) continue
    const minLen =
      typeof f.config?.minLength === 'number' && f.config.minLength >= 0 ? f.config.minLength : undefined
    const maxLen =
      typeof f.config?.maxLength === 'number' && f.config.maxLength > 0 ? f.config.maxLength : undefined
    const strVal = String(data[f.key] ?? '')

    // For masked text fields, count only characters that fill mask slots (@, #, *, 0, a).
    let effectiveLen = strVal.length
    const mask = f.config?.textPatternMask?.trim()
    if (f.type === 'text' && mask) {
      const slotCount = mask
        .split('')
        .filter((ch) => ch === '@' || ch === '#' || ch === '*' || ch === '0' || ch === 'a').length
      const slotChars = strVal.replace(/[^A-Za-z0-9]/g, '')
      effectiveLen = Math.min(slotChars.length, slotCount)
    }

    if (minLen != null && effectiveLen < minLen) {
      errors.push({
        fieldKey: f.key,
        message: `At least ${minLen} character${minLen === 1 ? '' : 's'}`,
      })
    } else if (maxLen != null && effectiveLen > maxLen) {
      errors.push({
        fieldKey: f.key,
        message: `At most ${maxLen} character${maxLen === 1 ? '' : 's'}`,
      })
    }
  }
  return errors
}
