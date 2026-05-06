/** Shared multi-segment / Add Stop rack mission helpers (fleet: two NODE_POINT rows per segment). */

export type ContinueMode = 'manual' | 'auto'

export const MAX_AUTO_CONTINUE_SECONDS = 86400

export type MultistopPlanDest = {
  position: string
  /** Kept for stored plan JSON compatibility; missionData / submitMission always use AUTO. */
  passStrategy?: 'AUTO' | 'MANUAL'
  waitingMillis?: number
  /** App-only: after arriving at this stop, wait for operator vs auto-continue (default manual). */
  continueMode?: ContinueMode
  /** Seconds to wait before auto-continue when continueMode is auto. */
  autoContinueSeconds?: number
  /**
   * Fleet NODE_POINT at this destination: drop pallet vs pickup-only at intermediate stops.
   * Final segment end leg always uses drop (`true`) regardless.
   */
  putDown?: boolean
}

/** Release timing after `containerIn`, before the first `submitMission` (pickup row in UI). */
export type MultistopPickupContinue = {
  continueMode: ContinueMode
  autoContinueSeconds?: number
}

export type MultistopPlan = {
  destinations: MultistopPlanDest[]
  /** When set, defers first segment using this; else legacy fallback uses `destinations[0]` continue fields. */
  pickupContinue?: MultistopPickupContinue
}

function parseContinueFields(o: Record<string, unknown>): MultistopPickupContinue {
  const cmRaw = o.continueMode
  const continueMode: ContinueMode = cmRaw === 'auto' ? 'auto' : 'manual'
  if (continueMode !== 'auto') return { continueMode: 'manual' }
  const n = typeof o.autoContinueSeconds === 'number' ? o.autoContinueSeconds : Number(o.autoContinueSeconds)
  if (!Number.isFinite(n) || n < 0) return { continueMode: 'manual' }
  if (n === 0) return { continueMode: 'auto', autoContinueSeconds: 0 }
  if (n < 1) return { continueMode: 'manual' }
  const sec = Math.min(Math.floor(n), MAX_AUTO_CONTINUE_SECONDS)
  return { continueMode: 'auto', autoContinueSeconds: sec }
}

function parseDestinationRecord(o: Record<string, unknown>): MultistopPlanDest | null {
  const position = typeof o.position === 'string' ? o.position.trim() : ''
  if (!position) return null
  const cf = parseContinueFields(o)
  const base: MultistopPlanDest = {
    position,
    passStrategy: 'AUTO',
    waitingMillis: 0,
    continueMode: cf.continueMode,
  }
  if (typeof o.putDown === 'boolean') base.putDown = o.putDown
  if (cf.continueMode !== 'auto' || cf.autoContinueSeconds === undefined) return base
  return { ...base, continueMode: 'auto', autoContinueSeconds: cf.autoContinueSeconds }
}

export function parseMultistopPlan(raw: unknown): MultistopPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const d = (raw as { destinations?: unknown }).destinations
  if (!Array.isArray(d)) return null
  const destinations: MultistopPlanDest[] = []
  for (const x of d) {
    if (!x || typeof x !== 'object') return null
    const row = parseDestinationRecord(x as Record<string, unknown>)
    if (!row) return null
    destinations.push(row)
  }
  if (destinations.length === 0) return null
  const pcRaw = (raw as { pickupContinue?: unknown }).pickupContinue
  let pickupContinue: MultistopPickupContinue | undefined
  if (pcRaw && typeof pcRaw === 'object') {
    pickupContinue = parseContinueFields(pcRaw as Record<string, unknown>)
  }
  return pickupContinue ? { destinations, pickupContinue } : { destinations }
}

export type NormalizeDestinationResult =
  | { ok: true; dest: MultistopPlanDest }
  | { ok: false; error: string }

/** Validate API input for one destination row (POST/PATCH create mission). */
export function normalizeDestinationInput(o: Record<string, unknown>): NormalizeDestinationResult {
  const position = typeof o.position === 'string' ? o.position.trim() : ''
  if (!position) return { ok: false, error: 'each destination needs position' }
  const cmRaw = o.continueMode
  const continueMode: ContinueMode = cmRaw === 'auto' ? 'auto' : 'manual'
  if (continueMode === 'auto') {
    const n = typeof o.autoContinueSeconds === 'number' ? o.autoContinueSeconds : Number(o.autoContinueSeconds)
    if (!Number.isFinite(n) || n < 0 || n > MAX_AUTO_CONTINUE_SECONDS) {
      return {
        ok: false,
        error: `autoContinueSeconds must be 0–${MAX_AUTO_CONTINUE_SECONDS} when continueMode is auto`,
      }
    }
    const dest: MultistopPlanDest = {
      position,
      passStrategy: 'AUTO',
      waitingMillis: 0,
      continueMode: 'auto',
      autoContinueSeconds: Math.floor(n),
    }
    if (typeof o.putDown === 'boolean') dest.putDown = o.putDown
    return { ok: true, dest }
  }
  const dest: MultistopPlanDest = { position, passStrategy: 'AUTO', waitingMillis: 0, continueMode: 'manual' }
  if (typeof o.putDown === 'boolean') dest.putDown = o.putDown
  return { ok: true, dest }
}

export type NormalizePickupContinueResult =
  | { ok: true; value: MultistopPickupContinue }
  | { ok: false; error: string }

/** Validate optional pickup-row release (POST/PATCH multistop). */
export function normalizePickupContinueInput(o: Record<string, unknown>): NormalizePickupContinueResult {
  const cmRaw = o.continueMode
  const continueMode: ContinueMode = cmRaw === 'auto' ? 'auto' : 'manual'
  if (continueMode === 'auto') {
    const n = typeof o.autoContinueSeconds === 'number' ? o.autoContinueSeconds : Number(o.autoContinueSeconds)
    if (!Number.isFinite(n) || n < 0 || n > MAX_AUTO_CONTINUE_SECONDS) {
      return {
        ok: false,
        error: `autoContinueSeconds must be 0–${MAX_AUTO_CONTINUE_SECONDS} when continueMode is auto`,
      }
    }
    return { ok: true, value: { continueMode: 'auto', autoContinueSeconds: Math.floor(n) } }
  }
  return { ok: true, value: { continueMode: 'manual' } }
}

/** Defer first segment after containerIn: explicit `pickupContinue`, else legacy `destinations[0]` continue fields. */
function pickupDeferSource(plan: MultistopPlan): MultistopPickupContinue | null {
  if (plan.pickupContinue) return plan.pickupContinue
  const d0 = plan.destinations[0]
  if (!d0) return null
  const cm = d0.continueMode ?? 'manual'
  if (cm === 'auto') {
    const sec = d0.autoContinueSeconds
    if (typeof sec === 'number' && Number.isFinite(sec) && sec >= 0) {
      return {
        continueMode: 'auto',
        autoContinueSeconds: Math.min(Math.max(0, Math.floor(sec)), MAX_AUTO_CONTINUE_SECONDS),
      }
    }
  }
  return { continueMode: 'manual' }
}

/**
 * True when segment 0 `submitMission` should **not** run in the create request: wait for Continue (manual) or
 * auto-timer (auto with ≥1s) after `containerIn`.
 */
export function shouldDeferFirstSegmentSubmit(plan: MultistopPlan): boolean {
  const src = pickupDeferSource(plan)
  if (!src) return false
  if (src.continueMode === 'manual') return true
  if (src.continueMode === 'auto') {
    const sec = src.autoContinueSeconds
    return typeof sec === 'number' && Number.isFinite(sec) && sec >= 1
  }
  return false
}

/** ISO deadline for worker auto-continue before first segment; `null` when manual (operator must Continue). */
export function continueNotBeforeDeferredFirstSegment(plan: MultistopPlan, nowMs: number): string | null {
  const src = pickupDeferSource(plan)
  if (!src || src.continueMode !== 'auto') return null
  const sec = src.autoContinueSeconds
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 1) return null
  const delayMs = Math.min(Math.floor(sec), MAX_AUTO_CONTINUE_SECONDS) * 1000
  return new Date(nowMs + delayMs).toISOString()
}

/**
 * After segment `completedSegmentIndex` finishes, robot waits at `destinations[completedSegmentIndex]`.
 * Returns ISO time when auto-continue should fire, or null for manual / final stop.
 */
export function computeContinueDeadlineIso(plan: MultistopPlan, completedSegmentIndex: number, nowMs: number): string | null {
  const dests = plan.destinations
  const total = dests.length
  if (completedSegmentIndex < 0 || completedSegmentIndex >= total - 1) return null
  const dest = dests[completedSegmentIndex]
  if (dest.continueMode !== 'auto') return null
  const sec = dest.autoContinueSeconds
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return null
  if (sec === 0) return new Date(nowMs).toISOString()
  if (sec < 1) return null
  const delayMs = Math.min(sec, MAX_AUTO_CONTINUE_SECONDS) * 1000
  return new Date(nowMs + delayMs).toISOString()
}

/**
 * While `awaiting_continue`, the robot is waiting before starting segment `nextSegmentIndex`.
 * That wait corresponds to stop index `nextSegmentIndex - 1`.
 */
export function continueNotBeforeForAwaitingSession(plan: MultistopPlan, nextSegmentIndex: number, nowMs: number): string | null {
  const waitingStopIdx = nextSegmentIndex - 1
  if (waitingStopIdx < 0) return null
  const total = plan.destinations.length
  if (waitingStopIdx >= total - 1) return null
  const dest = plan.destinations[waitingStopIdx]
  if (dest.continueMode !== 'auto') return null
  const sec = dest.autoContinueSeconds
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return null
  if (sec === 0) return new Date(nowMs).toISOString()
  if (sec < 1) return null
  const delayMs = Math.min(sec, MAX_AUTO_CONTINUE_SECONDS) * 1000
  return new Date(nowMs + delayMs).toISOString()
}

/** Segment index 0-based: pickup → destinations[0]; then destinations[i-1] → destinations[i]. */
export function buildSegmentMissionData(
  pickupPosition: string,
  plan: MultistopPlan,
  segmentIndex: number
): Array<Record<string, unknown>> {
  const dests = plan.destinations
  const total = dests.length
  if (segmentIndex < 0 || segmentIndex >= total) throw new Error('segmentIndex out of range')
  const startPos = segmentIndex === 0 ? pickupPosition.trim() : dests[segmentIndex - 1].position.trim()
  const end = dests[segmentIndex]
  /** Final stop always drops; intermediate uses plan `putDown` (default pickup-only). */
  const endPutDown = segmentIndex === total - 1 ? true : end.putDown === true
  const startLeg = {
    sequence: 1,
    position: startPos,
    type: 'NODE_POINT',
    passStrategy: 'AUTO',
    waitingMillis: 0,
    putDown: false,
  }
  const endLeg = {
    sequence: 2,
    position: end.position.trim(),
    type: 'NODE_POINT',
    passStrategy: 'AUTO',
    waitingMillis: 0,
    putDown: endPutDown,
  }
  return [startLeg, endLeg]
}

/**
 * Stand that must be empty before continuing segment `nextSegmentIndex`, aligned with {@link buildSegmentMissionData}.
 * Skips segment 0 (first fleet leg): create-time / pickup-row sanity covers that destination.
 */
export function multistopSegmentDropDestinationRef(
  plan: MultistopPlan,
  nextSegmentIndex: number
): string | null {
  const dests = plan.destinations
  const n = dests.length
  if (!Number.isFinite(nextSegmentIndex) || nextSegmentIndex < 0 || nextSegmentIndex >= n) return null
  if (nextSegmentIndex === 0) return null
  const end = dests[nextSegmentIndex]
  const isFinal = nextSegmentIndex === n - 1
  const endPutDown = isFinal ? true : end.putDown === true
  if (!endPutDown) return null
  const ref = end.position.trim()
  return ref || null
}

export function robotIdFromFleetJob(job: Record<string, unknown>): string {
  const id = job.robotId ?? job.robot_id
  return typeof id === 'string' ? id.trim() : ''
}
