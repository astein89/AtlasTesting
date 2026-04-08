import type { ConditionalFormatRule, FieldType } from '../types'
import type { DateTimeDisplayKind } from './dateTimeConfig'

export type CfStandardOpChoice = {
  value: NonNullable<ConditionalFormatRule['standardOp']>
  label: string
}

/** Default Cell value operators for non-datetime fields (numbers, text, etc.). */
const DEFAULT_CHOICES: CfStandardOpChoice[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equal' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'between', label: 'between (numbers)' },
  { value: 'contains', label: 'contains text' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'begins_with', label: 'begins with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'blank', label: 'is blank' },
  { value: 'not_blank', label: 'is not blank' },
]

const DATETIME_ORDER_DATE: CfStandardOpChoice[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equal' },
  { value: 'gt', label: 'after' },
  { value: 'gte', label: 'on or after' },
  { value: 'lt', label: 'before' },
  { value: 'lte', label: 'on or before' },
  { value: 'between', label: 'between (inclusive)' },
  { value: 'blank', label: 'is blank' },
  { value: 'not_blank', label: 'is not blank' },
]

const DATETIME_ORDER_TIME: CfStandardOpChoice[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equal' },
  { value: 'gt', label: 'after' },
  { value: 'gte', label: 'at or after' },
  { value: 'lt', label: 'before' },
  { value: 'lte', label: 'at or before' },
  { value: 'between', label: 'between (inclusive)' },
  { value: 'blank', label: 'is blank' },
  { value: 'not_blank', label: 'is not blank' },
]

const DATETIME_ORDER_FULL: CfStandardOpChoice[] = [
  ...DATETIME_ORDER_DATE.slice(0, 7),
  { value: 'contains', label: 'contains text' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'begins_with', label: 'begins with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'blank', label: 'is blank' },
  { value: 'not_blank', label: 'is not blank' },
]

/**
 * Operators shown for “Cell value” conditional formatting, aligned with field type and
 * (for datetime) the display mode. Numeric comparisons use the stored value (timestamps / ISO strings as supported by the matcher).
 */
export function getCfStandardOpChoices(
  fieldType: FieldType,
  dateTimeDisplay: DateTimeDisplayKind
): CfStandardOpChoice[] {
  if (fieldType !== 'datetime') {
    return DEFAULT_CHOICES
  }
  if (dateTimeDisplay === 'shortDate' || dateTimeDisplay === 'longDate') {
    return DATETIME_ORDER_DATE
  }
  if (dateTimeDisplay === 'shortTime' || dateTimeDisplay === 'longTime') {
    return DATETIME_ORDER_TIME
  }
  return DATETIME_ORDER_FULL
}

/** Input placeholder for single-value Cell value rules. */
export function getCfStandardValuePlaceholder(
  fieldType: FieldType,
  dateTimeDisplay: DateTimeDisplayKind
): string {
  if (fieldType !== 'datetime') return 'Value'
  if (dateTimeDisplay === 'shortDate' || dateTimeDisplay === 'longDate') {
    return 'e.g. 2025-03-15 or full ISO 8601'
  }
  if (dateTimeDisplay === 'shortTime' || dateTimeDisplay === 'longTime') {
    return 'e.g. ISO 8601 date-time'
  }
  return 'e.g. ISO 8601'
}
