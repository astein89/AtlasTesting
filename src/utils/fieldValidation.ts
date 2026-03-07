import type { DataField, TimerValue } from '../types'

export interface FieldValidationError {
  fieldKey: string
  message: string
}

/**
 * Returns validation errors for record data (minLength/maxLength for text/longtext).
 * Empty array if valid.
 */
export function getFieldValidationErrors(
  fields: DataField[],
  data: Record<string, string | number | boolean | string[] | TimerValue>
): FieldValidationError[] {
  const errors: FieldValidationError[] = []
  for (const f of fields) {
    if (f.type === 'formula') continue
    if (f.type !== 'text' && f.type !== 'longtext') continue
    const minLen = typeof f.config?.minLength === 'number' && f.config.minLength >= 0 ? f.config.minLength : undefined
    const maxLen = typeof f.config?.maxLength === 'number' && f.config.maxLength > 0 ? f.config.maxLength : undefined
    const val = String(data[f.key] ?? '')
    if (minLen != null && val.length < minLen) {
      errors.push({
        fieldKey: f.key,
        message: `At least ${minLen} character${minLen === 1 ? '' : 's'}`,
      })
    } else if (maxLen != null && val.length > maxLen) {
      errors.push({
        fieldKey: f.key,
        message: `At most ${maxLen} character${maxLen === 1 ? '' : 's'}`,
      })
    }
  }
  return errors
}
