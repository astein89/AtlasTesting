export type LocationSchemaFieldType = 'number' | 'text' | 'select'

export interface LocationSchemaFieldConfig {
  options?: string[]
  /** Parallel to `options` (same index): optional description shown in dropdowns / tooltips. */
  optionDescriptions?: string[]
  maxLength?: number
}

/** Display label for a select option (stored value + optional description). */
export function formatSelectOptionLabel(value: string, config: LocationSchemaFieldConfig): string {
  const opts = config.options ?? []
  const descs = config.optionDescriptions
  const i = opts.indexOf(value)
  if (i < 0 || !descs?.length || i >= descs.length) return value
  const d = String(descs[i] ?? '').trim()
  return d ? `${value} — ${d}` : value
}

/** Tooltip text for a select option (description only, if any). */
export function selectOptionTitle(value: string, config: LocationSchemaFieldConfig): string | undefined {
  const opts = config.options ?? []
  const descs = config.optionDescriptions
  const i = opts.indexOf(value)
  if (i < 0 || !descs?.length || i >= descs.length) return undefined
  const d = String(descs[i] ?? '').trim()
  return d || undefined
}

export interface LocationSchemaField {
  id: string
  schemaId: string
  key: string
  label: string
  type: LocationSchemaFieldType
  config: LocationSchemaFieldConfig
  orderIndex?: number
}

export type LocationFieldValues = Record<string, string | number>
