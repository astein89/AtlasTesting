export type FieldType = 'number' | 'text' | 'longtext' | 'boolean' | 'datetime' | 'select' | 'status' | 'fraction' | 'atlas_location' | 'image' | 'timer' | 'formula'

/** Timer field value: elapsed time from timestamps so it can run for extended periods */
export interface TimerValue {
  /** Accumulated elapsed milliseconds (before current segment) */
  totalElapsedMs: number
  /** When set, timer is running; elapsed = totalElapsedMs + (now - startedAt) */
  startedAt?: string
  /** When set, timer was stopped/paused at this time (for hover tooltip) */
  stoppedAt?: string
}

/** Default options for status fields when no custom options are set */
export const STATUS_OPTIONS = [
  'Blocked',
  'Complete',
  'Failed',
  'In Progress',
  'Passed',
  'Retest',
  'Skipped',
] as const

export interface FieldConfig {
  unit?: string
  min?: number
  max?: number
  options?: string[]
  required?: boolean
  /** Fraction scale (2, 4, 8, 16, 32, 64, 128). For fraction fields: input denominator. For formula: when set, display numeric result rounded to this fraction (e.g. 16 = 16ths). */
  fractionScale?: number
  /** For image fields: true = multiple photos, false = single photo */
  imageMultiple?: boolean
  /** For image fields: optional tag/label (e.g. "Before", "Defect photo") shown with the field */
  imageTag?: string
  /** For status fields: optional hex color per option value, e.g. { 'Complete': '#22c55e' } */
  statusColors?: Record<string, string>
  /** For number/formula fields: max digits before decimal (integer part), optional display width */
  integerDigits?: number
  /** For number/formula fields: decimal places for display (rounds numeric values) */
  decimalPlaces?: number
  /** Excel-style: 'number' | 'percent' | 'currency' */
  numberFormat?: 'number' | 'percent' | 'currency'
  /** Use thousands separator (e.g. 1,234.56) */
  thousandsSeparator?: boolean
  /** How to show negative: 'minus' = -1234, 'parentheses' = (1234) */
  negativeStyle?: 'minus' | 'parentheses'
  /** When numberFormat is 'currency', symbol to show (e.g. '$', '€') */
  currencySymbol?: string
  /** For text/longtext fields: min character length */
  minLength?: number
  /** For text/longtext fields: max character length */
  maxLength?: number
  /** For text/longtext fields: disallow spaces in input */
  textDisallowSpaces?: boolean
  /** For text/longtext fields: characters not allowed (e.g. "@#$"); any listed char is stripped */
  textUnallowedChars?: string
  /** For text/longtext fields: enforce case for letters */
  textCase?: 'upper' | 'lower' | 'none'
  /** For text fields only: imask pattern (e.g. "000-000" for digits, see https://imask.js.org/guide.html#masked-pattern) */
  textPatternMask?: string
  /** For formula fields: the M-like expression (e.g. [Length] * [Width]). For status fields: when set, status is computed from this formula (read-only per record). */
  formula?: string
  /** For datetime fields: date-fns format string for display (e.g. 'MM/dd/yyyy HH:mm'). When set, overrides app default for this field. */
  dateTimeFormat?: string
  /** For datetime fields: what to show — short date, long date, date/time, long time, or short time. When set, used instead of dateTimeFormat. */
  dateTimeDisplay?: 'shortDate' | 'longDate' | 'dateTime' | 'longTime' | 'shortTime'
}

/** Options for a status field: custom config.options or default STATUS_OPTIONS. Blank options are preserved. */
export function getStatusOptions(field: { config?: FieldConfig } | null | undefined): string[] {
  const opts = field?.config?.options
  if (Array.isArray(opts) && opts.length > 0) return opts
  return [...STATUS_OPTIONS]
}

export interface DataField {
  id: string
  key: string
  label: string
  type: FieldType
  config?: FieldConfig
  createdAt?: string | null
  updatedAt?: string | null
  createdBy?: string | null
  updatedBy?: string | null
  createdByName?: string | null
  updatedByName?: string | null
}

export interface TestPlan {
  id: string
  name: string
  /** Brief summary (for lists). Stored in DB as short_description. */
  description?: string
  /** Long text shown below plan title. Stored in DB as description. */
  testPlan?: string
  constraints?: string
  fieldIds?: string[]
  /** Map of field id -> width (e.g. "80px", "120px", "auto") for data table */
  fieldLayout?: Record<string, string>
  /** Ordered list of field ids and separator ids (newline-xxx) for form layout */
  formLayoutOrder?: string[]
  /** Default sort for data view: e.g. [{ key: 'date', dir: 'desc' }] */
  defaultSortOrder?: Array<{ key: string; dir: 'asc' | 'desc' }>
  /** Default values per field key when adding a record (by test plan) */
  fieldDefaults?: Record<string, string | number | boolean | string[] | TimerValue>
  /** Field key to use when naming files (e.g. exports); not unique, for labelling only */
  keyField?: string
  /** Plan active period start (YYYY-MM-DD). Records outside start/end are "archived". */
  startDate?: string
  /** Plan active period end (YYYY-MM-DD). Records outside start/end are "archived". */
  endDate?: string
  /** Saved archived runs (start/end date ranges, runId set when archived). */
  archivedRuns?: Array<{ startDate: string; endDate: string; runId?: string }>
  /** Field ids to hide from data table, edit/add forms, and result detail (variables still stored with record). */
  hiddenFieldIds?: string[]
  /** Field ids that are required when entering records for this plan. */
  requiredFieldIds?: string[]
  /** Field ids that should be visible by default in the data table (non-hidden fields). */
  defaultVisibleColumnIds?: string[]
  createdAt?: string
  /** Number of records in this plan (from list endpoint) */
  recordCount?: number
}

export interface DataRecord {
  id: string
  testPlanId: string
  planName?: string
  recordedAt: string
  enteredBy: string
  status: 'pass' | 'fail' | 'partial'
  data: Record<string, string | number | boolean | string[] | TimerValue>
}

export interface User {
  id: string
  username: string
  name?: string
  role: 'admin' | 'user' | 'viewer'
}
