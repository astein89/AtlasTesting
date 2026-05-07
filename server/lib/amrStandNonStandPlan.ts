import type { AsyncDbWrapper } from '../db/schema.js'
import type { MultistopPlan } from './amrMultistop.js'
import { externalRefsNonStandLocation } from './amrStandLocationType.js'

/**
 * Validates pickup + destinations: non-stand waypoints cannot start or end a mission; intermediates force `putDown: false`.
 */
export async function applyMultistopNonStandRules(
  db: AsyncDbWrapper,
  plan: MultistopPlan,
  opts?: { pickupPosition?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pickup = (opts?.pickupPosition ?? '').trim()
  if (pickup) {
    const pickupSet = await externalRefsNonStandLocation(db, [pickup])
    if (pickupSet.has(pickup)) {
      return {
        ok: false,
        error:
          'Pickup cannot be a non-stand waypoint. Missions must start from a rack stand (change the stand’s location type or pick a different ref).',
      }
    }
  }
  const dests = plan.destinations
  const nd = dests.length
  if (nd === 0) return { ok: true }
  const refs = dests.map((d) => (d.position ?? '').trim()).filter(Boolean)
  const nonStand = await externalRefsNonStandLocation(db, refs)
  const lastRef = dests[nd - 1].position.trim()
  if (lastRef && nonStand.has(lastRef)) {
    return {
      ok: false,
      error:
        'A non-stand (waypoint) location cannot be the final stop in a mission. Pick a rack stand as the destination.',
    }
  }
  for (let i = 0; i < nd; i++) {
    const p = dests[i].position.trim()
    if (p && nonStand.has(p) && i < nd - 1) dests[i].putDown = false
  }
  return { ok: true }
}
