import type { AsyncDbWrapper } from '../db/schema.js'

/** Normal rack/storage stand tracked by pallet presence rules. */
export const AMR_STAND_LOCATION_TYPE_STAND = 'stand'
/** Waypoint — no pallet drop-off stand; pallet continues after stop. No Hyperion pallet presence. */
export const AMR_STAND_LOCATION_TYPE_NON_STAND = 'non_stand'

export type AmrStandLocationType = typeof AMR_STAND_LOCATION_TYPE_STAND | typeof AMR_STAND_LOCATION_TYPE_NON_STAND

export function normalizeAmrStandLocationType(raw: unknown): AmrStandLocationType {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return s === AMR_STAND_LOCATION_TYPE_NON_STAND ? AMR_STAND_LOCATION_TYPE_NON_STAND : AMR_STAND_LOCATION_TYPE_STAND
}

export async function externalRefsNonStandLocation(
  db: AsyncDbWrapper,
  refs: string[]
): Promise<Set<string>> {
  const trimmed = [...new Set(refs.map((r) => String(r).trim()).filter(Boolean))]
  if (trimmed.length === 0) return new Set()
  const placeholders = trimmed.map(() => '?').join(', ')
  const rows = (await db
    .prepare(
      `SELECT external_ref FROM amr_stands
       WHERE external_ref IN (${placeholders}) AND COALESCE(location_type, 'stand') = ?`
    )
    .all(...trimmed, AMR_STAND_LOCATION_TYPE_NON_STAND)) as Array<{ external_ref?: string }>
  const out = new Set<string>()
  for (const r of rows) {
    const ref = typeof r.external_ref === 'string' ? r.external_ref.trim() : ''
    if (ref) out.add(ref)
  }
  return out
}

export async function externalRefUsesNonStandRow(db: AsyncDbWrapper, externalRef: string): Promise<boolean> {
  const ref = externalRef.trim()
  if (!ref) return false
  const s = await externalRefsNonStandLocation(db, [ref])
  return s.has(ref)
}

export async function standIdIsAssignedToStandGroup(db: AsyncDbWrapper, standId: string): Promise<boolean> {
  const id = standId.trim()
  if (!id) return false
  const row = (await db
    .prepare('SELECT group_id FROM amr_stand_group_members WHERE stand_id = ? LIMIT 1')
    .get(id)) as { group_id?: string } | undefined
  return Boolean(row?.group_id)
}
