import type { DataField } from '../types'

export interface LayoutCell {
  field: DataField
  span: 1 | 2 | 3 | 4
}

export type LayoutRow = LayoutCell[] | { type: 'separator' }

/** 6-column grid: 1=1/3, 2=2/3, 3=full, 4=1/2 */
export const FORM_GRID_COLS = 6

/** Col-span for each span value in a 6-col grid */
export const SPAN_TO_COLS: Record<1 | 2 | 3 | 4, number> = {
  1: 2,   // 1/3
  2: 4,   // 2/3
  3: 6,   // full
  4: 3,   // 1/2
}

const NEWLINE_PREFIX = 'newline-'
const SEPARATOR_LINE_PREFIX = 'separator-'

export function isSeparatorId(id: string): boolean {
  return id.startsWith(NEWLINE_PREFIX)
}

export function isSeparatorLineId(id: string): boolean {
  return id.startsWith(SEPARATOR_LINE_PREFIX)
}

/** Parse field id with optional span suffix (fieldId, fieldId:2, fieldId:3, fieldId:4). */
export function parseFieldEntry(id: string): { fieldId: string; span: 1 | 2 | 3 | 4 } {
  const colon = id.lastIndexOf(':')
  if (colon > 0) {
    const fieldId = id.slice(0, colon)
    const n = parseInt(id.slice(colon + 1), 10)
    if (n === 2 || n === 3 || n === 4) return { fieldId, span: n }
  }
  return { fieldId: id, span: 1 }
}

/** Format field id with span (omit :1 for default 1/3). */
export function formatFieldEntry(fieldId: string, span: 1 | 2 | 3 | 4): string {
  return span === 1 ? fieldId : `${fieldId}:${span}`
}

/** Extract base field id from order entry (strips :2, :3, :4). */
export function getBaseFieldId(entry: string): string {
  return parseFieldEntry(entry).fieldId
}

export function createSeparatorId(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return NEWLINE_PREFIX + uuid
}

export function createSeparatorLineId(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return SEPARATOR_LINE_PREFIX + uuid
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

/** Extract field ids from formLayoutOrder (base ids only, no separators). */
export function getFieldIdsFromOrder(formLayoutOrder: string[]): string[] {
  return formLayoutOrder
    .filter((id) => !isSeparatorId(id) && !isSeparatorLineId(id))
    .map(getBaseFieldId)
}

/** Build rows from formLayoutOrder (field ids, newline-xxx, separator-xxx). */
export function buildFormRowsFromOrder(
  fields: DataField[],
  formLayoutOrder: string[]
): LayoutRow[] {
  const fieldMap = new Map(fields.map((f) => [f.id, f]))
  const rows: LayoutRow[] = []
  let currentRow: LayoutCell[] = []

  for (const id of formLayoutOrder) {
    if (isSeparatorId(id)) {
      if (currentRow.length > 0) {
        rows.push(currentRow)
        currentRow = []
      }
      continue
    }

    if (isSeparatorLineId(id)) {
      if (currentRow.length > 0) {
        rows.push(currentRow)
        currentRow = []
      }
      rows.push({ type: 'separator' })
      continue
    }

    const { fieldId, span } = parseFieldEntry(id)
    const field = fieldMap.get(fieldId)
    if (!field) continue

    const spanCols = SPAN_TO_COLS[span]
    const currentCols = currentRow.reduce((s, c) => s + SPAN_TO_COLS[c.span], 0)
    if (currentCols + spanCols > FORM_GRID_COLS && currentRow.length > 0) {
      rows.push(currentRow)
      currentRow = []
    }
    currentRow.push({ field, span })
    if (currentRow.reduce((s, c) => s + SPAN_TO_COLS[c.span], 0) >= FORM_GRID_COLS) {
      rows.push(currentRow)
      currentRow = []
    }
  }

  if (currentRow.length > 0) rows.push(currentRow)
  return rows
}
