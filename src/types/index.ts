export type FieldType = 'number' | 'text' | 'longtext' | 'boolean' | 'datetime' | 'select' | 'fraction' | 'atlas_location' | 'image'

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
}

export interface DataField {
  id: string
  key: string
  label: string
  type: FieldType
  config?: FieldConfig
}

export interface TestPlan {
  id: string
  name: string
  description?: string
  constraints?: string
  fieldIds?: string[]
  /** Map of field id -> width (e.g. "80px", "120px", "auto") for data table */
  fieldLayout?: Record<string, string>
  /** Ordered list of field ids and separator ids (newline-xxx) for form layout */
  formLayoutOrder?: string[]
  createdAt?: string
}

export interface Test {
  id: string
  testPlanId: string
  name: string
  description?: string
  fieldIds: string[]
}

export interface DataRecord {
  id: string
  testId: string
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
