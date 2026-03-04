import type { DataField } from '../types'

export interface LayoutCell {
  field: DataField
  span: 1 | 2 | 3
}

export const FORM_GRID_COLS = 3

const SEPARATOR_PREFIX = 'newline-'

export function isSeparatorId(id: string): boolean {
  return id.startsWith(SEPARATOR_PREFIX)
}

export function createSeparatorId(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return SEPARATOR_PREFIX + uuid
}

/** Normalize formLayoutOrder: must be array of strings, else use field order. */
export function normalizeFormLayoutOrder(
  formLayoutOrder: unknown,
  fields: DataField[]
): string[] {
  if (Array.isArray(formLayoutOrder) && formLayoutOrder.length > 0) {
    return formLayoutOrder.filter((x): x is string => typeof x === 'string')
  }
  return fields.map((f) => f.id)
}

/** Build rows from formLayoutOrder (array of field ids and separator ids). */
export function buildFormRowsFromOrder(
  fields: DataField[],
  formLayoutOrder: string[]
): LayoutCell[][] {
  const fieldMap = new Map(fields.map((f) => [f.id, f]))
  const rows: LayoutCell[][] = []
  let currentRow: LayoutCell[] = []

  for (const id of formLayoutOrder) {
    if (isSeparatorId(id)) {
      if (currentRow.length > 0) {
        rows.push(currentRow)
        currentRow = []
      }
      continue
    }

    const field = fieldMap.get(id)
    if (!field) continue

    currentRow.push({ field, span: 1 })
    if (currentRow.length === FORM_GRID_COLS) {
      rows.push(currentRow)
      currentRow = []
    }
  }

  if (currentRow.length > 0) rows.push(currentRow)
  return rows
}
