import type { AsyncDbWrapper } from '../db/schema.js'
import type { MultistopPlan } from './amrMultistop.js'

/**
 * Previously enforced no pickup/final stop on `non_stand` and forced intermediates to `putDown: false`.
 * Waypoints now allow lift/lower like rack stands, subject to `block_pickup` / `block_dropoff`.
 * Kept as a stable async hook for mission/template write paths.
 */
export async function applyMultistopNonStandRules(
  _db: AsyncDbWrapper,
  _plan: MultistopPlan,
  _opts?: { pickupPosition?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: true }
}
