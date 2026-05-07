/** Rack stand with pallet presence semantics. */
export const AMR_STAND_LOCATION_TYPE_STAND = 'stand' as const
/** Waypoint node — pallet is not deposited; Hyperion occupancy N/A at this Fleet ref. */
export const AMR_STAND_LOCATION_TYPE_NON_STAND = 'non_stand' as const

export type AmrStandLocationType = typeof AMR_STAND_LOCATION_TYPE_STAND | typeof AMR_STAND_LOCATION_TYPE_NON_STAND

export function normalizeAmrStandLocationType(raw: unknown): AmrStandLocationType {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return s === AMR_STAND_LOCATION_TYPE_NON_STAND ? AMR_STAND_LOCATION_TYPE_NON_STAND : AMR_STAND_LOCATION_TYPE_STAND
}

/** External refs for stands marked `non_stand` (palette / occupancy UI skips these). */
export function standRefsNonStandWaypoint(
  stands: Array<{ external_ref?: unknown; location_type?: unknown }>
): Set<string> {
  const out = new Set<string>()
  for (const s of stands) {
    const ref = typeof s.external_ref === 'string' ? s.external_ref.trim() : ''
    if (!ref) continue
    if (normalizeAmrStandLocationType(s.location_type) === AMR_STAND_LOCATION_TYPE_NON_STAND) out.add(ref)
  }
  return out
}

/**
 * Refs where Hyperion occupancy is skipped (`bypass_pallet_check` or `non_stand` waypoint).
 * Used with create‑time warnings / multistop continue gating.
 */
export function standRefsSkippingHyperionOccupancy(
  stands: Array<{ external_ref?: unknown; bypass_pallet_check?: unknown; location_type?: unknown }>
): Set<string> {
  const out = new Set<string>()
  for (const s of stands) {
    const ref = typeof s.external_ref === 'string' ? s.external_ref.trim() : ''
    if (!ref) continue
    if (Number(s.bypass_pallet_check) === 1) out.add(ref)
    if (normalizeAmrStandLocationType(s.location_type) === AMR_STAND_LOCATION_TYPE_NON_STAND) out.add(ref)
  }
  return out
}

export function refIsNonStandWaypoint(ref: string | null | undefined, nonStandRefs: Set<string>): boolean {
  const r = ref?.trim()
  return Boolean(r && nonStandRefs.has(r))
}
