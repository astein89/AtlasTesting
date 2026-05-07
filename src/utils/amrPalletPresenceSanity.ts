/** Minimal destination shape for Hyperion occupancy checks during multistop continue. */
export type MultistopReleasePlanDest = { position: string; putDown?: boolean }

/**
 * Parses `plan_json` from GET session (JSON string or already-parsed object from adapters).
 */
export function parseMultistopReleasePlanDestinations(raw: unknown): MultistopReleasePlanDest[] | null {
  let parsed: unknown
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw
  } else {
    return null
  }
  const d = (parsed as { destinations?: unknown }).destinations
  if (!Array.isArray(d)) return null
  const out: MultistopReleasePlanDest[] = []
  for (const x of d) {
    if (!x || typeof x !== 'object') return null
    const row = x as Record<string, unknown>
    const position = typeof row.position === 'string' ? row.position.trim() : ''
    if (!position) return null
    out.push({ position, putDown: row.putDown === true })
  }
  return out.length > 0 ? out : null
}

export function sessionNextSegmentIndex(session: Record<string, unknown>): number {
  const raw = session.next_segment_index ?? session.nextSegmentIndex
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw)
  return Number.isFinite(n) ? Math.floor(n) : NaN
}

/** Copy for stand-occupied Continue / release errors. */
export function multistopStandOccupiedContinueMessage(destinationRef: string): string {
  const ref = destinationRef.trim()
  return ref ? `Pallet present on stand ${ref}. Unable to dispatch.` : `Pallet present on stand. Unable to dispatch.`
}

/**
 * Next segment’s drop destination external ref (if any), aligned with server `multistopSegmentDropDestinationRef` /
 * `buildSegmentMissionData` (final segment always drops; intermediates only when `putDown` is true).
 */
export function multistopContinueOccupiedDestinationRef(
  plan: MultistopReleasePlanDest[],
  nextSeg: number,
  nonStandWaypointRefs?: Set<string>
): string | null {
  if (!plan.length || !Number.isFinite(nextSeg) || nextSeg < 0 || nextSeg >= plan.length) return null
  const dest = plan[nextSeg]
  const isFinal = nextSeg === plan.length - 1
  const movingPalletToDestination = isFinal || dest.putDown === true
  if (!movingPalletToDestination) return null
  const ref = dest.position.trim()
  if (!ref) return null
  if (nonStandWaypointRefs?.has(ref)) return null
  return ref
}

/**
 * Create-time sanity: only check the first segment destination (stop 2).
 * If that destination is a drop (`putDown=true`), it should be empty before create.
 */
/** Stands with `bypass_pallet_check` (from `amr_stands`) — empty-stand checks are skipped for these external refs. */
export function standRefsBypassingPalletCheck(
  stands: Array<{ external_ref?: unknown; bypass_pallet_check?: unknown }>
): Set<string> {
  const out = new Set<string>()
  for (const s of stands) {
    const ref = typeof s.external_ref === 'string' ? s.external_ref.trim() : ''
    if (!ref) continue
    if (Number(s.bypass_pallet_check) === 1) out.add(ref)
  }
  return out
}

export function refBypassesPalletCheck(ref: string | null | undefined, bypassRefs: Set<string>): boolean {
  const r = ref?.trim()
  return Boolean(r && bypassRefs.has(r))
}

/**
 * When stand-presence sanity is on, disable Continue/Release until Hyperion reports empty (`false`)
 * for the next continue destination stand — unless bypassed or presence integration is unavailable.
 */
export function multistopContinueReleaseDisabledUntilStandShowsEmpty(opts: {
  sanityEnabled: boolean
  nextOccupiedCheckRef: string | null
  bypassRefs: Set<string>
  presenceMap: Record<string, boolean | null>
  routePresenceUnconfig: boolean
  routePresenceError: boolean
}): boolean {
  if (!opts.sanityEnabled) return false
  const ref = opts.nextOccupiedCheckRef?.trim() || null
  if (!ref) return false
  if (refBypassesPalletCheck(ref, opts.bypassRefs)) return false
  if (opts.routePresenceUnconfig || opts.routePresenceError) return false
  return opts.presenceMap[ref] !== false
}

export function shouldWarnFirstSegmentDropOccupied(
  legs: Array<{ position: string; putDown?: boolean }>,
  presence: Record<string, boolean>,
  bypassRefs?: Set<string>
): { shouldWarn: boolean; destinationRef: string } {
  if (legs.length < 2) return { shouldWarn: false, destinationRef: '' }
  const firstDest = legs[1]
  if (firstDest.putDown !== true) return { shouldWarn: false, destinationRef: '' }
  const destinationRef = firstDest.position.trim()
  if (!destinationRef) return { shouldWarn: false, destinationRef: '' }
  if (bypassRefs?.has(destinationRef)) return { shouldWarn: false, destinationRef }
  return { shouldWarn: presence[destinationRef] === true, destinationRef }
}

/**
 * Create-time sanity: stop 1 (pickup / first NODE) must report a pallet if Hyperion says the stand is empty (`false`).
 * Unknown / missing entries do not warn (same caution as elsewhere).
 */
export function shouldWarnFirstStopPickupAbsent(
  legs: Array<{ position: string }>,
  presence: Record<string, boolean>,
  bypassRefs?: Set<string>
): { shouldWarn: boolean; pickupRef: string } {
  if (legs.length < 2) return { shouldWarn: false, pickupRef: '' }
  const pickupRef = legs[0].position.trim()
  if (!pickupRef) return { shouldWarn: false, pickupRef: '' }
  if (bypassRefs?.has(pickupRef)) return { shouldWarn: false, pickupRef }
  return { shouldWarn: presence[pickupRef] === false, pickupRef }
}
