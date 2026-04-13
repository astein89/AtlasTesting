import type { DataField } from '../types'

/** Stored in `TestPlan.mainStatusFieldId`: no status control in the Add/Edit row header. */
export const MAIN_STATUS_NONE = 'none' as const

/**
 * Default status field for the Add/Edit row header (next to the date).
 * When `mainStatusFieldId` is unset or invalid, uses the first status field on the plan (automatic).
 * When {@link MAIN_STATUS_NONE}, no status is shown in the header (all status fields stay in the form).
 */
export function resolveHeaderStatusField(
  fields: DataField[],
  mainStatusFieldId?: string | null
): DataField | undefined {
  const statusFields = fields.filter((f) => f.type === 'status')
  if (statusFields.length === 0) return undefined
  if (mainStatusFieldId === MAIN_STATUS_NONE) return undefined
  if (mainStatusFieldId) {
    const picked = statusFields.find((f) => f.id === mainStatusFieldId)
    if (picked) return picked
  }
  return statusFields[0]
}
