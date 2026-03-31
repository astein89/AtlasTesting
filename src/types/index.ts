export type FieldType =
  | 'number'
  | 'text'
  | 'longtext'
  | 'boolean'
  | 'datetime'
  | 'select'
  | 'radio_select'
  | 'checkbox_select'
  | 'status'
  | 'fraction'
  | 'weight'
  | 'atlas_location'
  | 'image'
  | 'timer'
  | 'formula'

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
  /** Default unit when opening the keypad/modal. For fraction: 'in' | 'mm'. For weight: 'kg' | 'g' | 'lb' | 'oz'. Omit or same as unit = use storage unit. */
  entryUnit?: string
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
  /** For number/formula fields: decimal places (see decimalPlacesMode where applicable). */
  decimalPlaces?: number
  /**
   * With decimalPlaces set:
   * - `display` — round only for display (tables/read-only); entry or internal value keeps full precision.
   * - `enforce` — round on entry (where applicable) and in stored/displayed value to decimalPlaces.
   */
  decimalPlacesMode?: 'display' | 'enforce'
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
  /** For radio_select fields: how to display options — 1 = one per line, 2+ = that many per line, or 'auto' = inline wrap. Legacy 'vertical'/'horizontal' map to 1/'auto'. */
  radioLayout?: number | 'vertical' | 'horizontal' | 'auto'
  /** For checkbox_select fields: same layout semantics as radioLayout. */
  checkboxLayout?: number | 'vertical' | 'horizontal' | 'auto'
  /**
   * Excel-like conditional formatting for this field in data tables (first matching rule wins).
   * Formula mode: same syntax as field formulas ([FieldKey], comparisons, AND, OR).
   * Standard mode: compares this cell’s value only.
   */
  conditionalFormatting?: ConditionalFormatRule[]
}

  /** One conditional format rule: when it matches, apply style to the cell display. */
export interface ConditionalFormatRule {
  id: string
  /**
   * How this rule applies:
   * - 'standard'  → compare this cell only (Cell value)
   * - 'formula'   → full-row expression (Formula)
   * - 'fallback'  → no condition; styles any rows not matched by earlier rules.
   */
  mode: 'formula' | 'standard' | 'fallback'
  /** mode formula — e.g. [Amount] > 100 AND [Status] = "Fail" */
  formula?: string
  /** mode standard — how to compare this field’s raw value */
  standardOp?:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'between'
    | 'contains'
    | 'not_contains'
    | 'begins_with'
    | 'ends_with'
    | 'blank'
    | 'not_blank'
  standardValue?: string
  /** second bound for between (inclusive) */
  standardValue2?: string
  /** Cell background; omit or empty = no fill */
  backgroundColor?: string
  /** Text color; omit or empty = inherit table text */
  textColor?: string
  fontBold?: boolean
  /**
   * When true (typically on a later rule), apply this formatting to all rows
   * that did NOT match any earlier rule ("else" / fallback style).
   */
  appliesToOthers?: boolean
}

/** One cell comparison in a Status Conditional “Cell value” rule (after formulas run). */
export interface ConditionalStatusStandardClause {
  /** How this clause combines with the result of all previous clauses (omit on the first clause). */
  combine?: 'and' | 'or'
  fieldKey: string
  op: ConditionalFormatRule['standardOp']
  value?: string
  value2?: string
}

/**
 * Per status option on a test plan: when this condition matches (same modes as conditional formatting,
 * minus fallback), plan automation may set that option on a row (unless user-locked).
 */
export interface ConditionalStatusOptionCondition {
  id?: string
  mode: 'formula' | 'standard'
  formula?: string
  /** Preferred: ordered cell clauses; each line after the first has `combine` with the running result. */
  standardClauses?: ConditionalStatusStandardClause[]
  /** @deprecated Legacy single / two-clause shape; use `standardClauses` when saving from the editor. */
  standardFieldKey?: string
  standardOp?: ConditionalFormatRule['standardOp']
  standardValue?: string
  standardValue2?: string
  standardLogicalOp?: 'and' | 'or'
  standardFieldKey2?: string
  standardOp2?: ConditionalFormatRule['standardOp']
  standardValueB?: string
  standardValue2B?: string
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
  /** When set, this field is owned by a specific test plan and is plan-specific. When null/undefined, the field is global. */
  ownerTestPlanId?: string | null
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
  /**
   * Plan-only Status Conditionals: field id → status option label → condition.
   * If `conditionalStatusRuleOrder` has an entry for a field id, that array defines evaluation
   * order (first matching configured row wins). Otherwise option order on the field is used (legacy).
   */
  conditionalStatusRules?: Record<string, Record<string, ConditionalStatusOptionCondition | null | undefined>>
  /** Per status field id: ordered list of status labels in the Status Conditionals table (subset of field options). */
  conditionalStatusRuleOrder?: Record<string, string[]>
  createdAt?: string
  updatedAt?: string | null
  /** Number of records in this plan (from list endpoint) */
  recordCount?: number
}

/** A first-class test under a test plan (has its own records and dates). */
export interface Test {
  id: string
  testPlanId: string
  name: string
  startDate?: string
  endDate?: string
  archived?: boolean
  createdAt?: string
  updatedAt?: string
  recordCount?: number
}

export interface DataRecord {
  id: string
  testPlanId: string
  /** When set, record belongs to this test under the plan. */
  testId?: string
  planName?: string
  recordedAt: string
  /** Last edit timestamp (from record_history), or recordedAt when never edited. */
  lastEditedAt?: string
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
