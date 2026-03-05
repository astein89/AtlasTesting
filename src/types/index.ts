export type FieldType = 'number' | 'text' | 'longtext' | 'boolean' | 'datetime' | 'select' | 'status' | 'fraction' | 'atlas_location' | 'image'

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
  /** Fraction scale (2, 4, 8, 16, 32, 64, 128) for fraction fields */
  fractionScale?: number
  /** For image fields: true = multiple photos, false = single photo */
  imageMultiple?: boolean
  /** For status fields: optional hex color per option value, e.g. { 'Complete': '#22c55e' } */
  statusColors?: Record<string, string>
}

/** Options for a status field: custom config.options or default STATUS_OPTIONS */
export function getStatusOptions(field: { config?: FieldConfig } | null | undefined): string[] {
  const opts = field?.config?.options
  if (Array.isArray(opts) && opts.length > 0) return opts.filter(Boolean)
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
  description?: string
  shortDescription?: string
  constraints?: string
  fieldIds?: string[]
  /** Map of field id -> width (e.g. "80px", "120px", "auto") for data table */
  fieldLayout?: Record<string, string>
  /** Ordered list of field ids and separator ids (newline-xxx) for form layout */
  formLayoutOrder?: string[]
  /** Default sort for data view: e.g. [{ key: 'date', dir: 'desc' }] */
  defaultSortOrder?: Array<{ key: string; dir: 'asc' | 'desc' }>
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
  data: Record<string, string | number | boolean | string[]>
}

export interface User {
  id: string
  username: string
  name?: string
  role: 'admin' | 'user'
}
