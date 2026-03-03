export type FieldType = 'number' | 'text' | 'longtext' | 'boolean' | 'datetime' | 'select'

export interface FieldConfig {
  unit?: string
  min?: number
  max?: number
  options?: string[]
  required?: boolean
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
  fieldIds?: string[]
  /** Map of field id -> width (e.g. "80px", "120px", "auto") */
  fieldLayout?: Record<string, string>
  createdAt?: string
}

export interface Test {
  id: string
  testPlanId: string
  name: string
  description?: string
  fieldIds: string[]
}

export interface TestRun {
  id: string
  testId: string
  runAt: string
  enteredBy: string
  status: 'pass' | 'fail' | 'partial'
  data: Record<string, string | number | boolean>
}

export interface User {
  id: string
  username: string
  name?: string
  role: 'admin' | 'user'
}
