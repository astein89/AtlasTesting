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
  /** Lazy-resolve pool (stop 2+); when set, `position` may be empty until dispatch. */
  groupId?: string
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
  /**
   * Per segment (length === destinations.length): fleet `putDown` on **first** NODE_POINT of that segment
   * (pickup stand for segment 0; previous destination stand for segment i&gt;0). Default false when omitted.
   */
  segmentFirstNodePutDown?: boolean[]
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
  const groupId = typeof o.groupId === 'string' ? o.groupId.trim() : ''
  if (!position && !groupId) return null
  const cf = parseContinueFields(o)
  const base: MultistopPlanDest = {
    position,
    passStrategy: 'AUTO',
    waitingMillis: 0,
    continueMode: cf.continueMode,
  }
  if (groupId) base.groupId = groupId
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
  const segRaw = (raw as { segmentFirstNodePutDown?: unknown }).segmentFirstNodePutDown
  let segmentFirstNodePutDown: boolean[] | undefined
  if (Array.isArray(segRaw) && segRaw.length === destinations.length) {
    segmentFirstNodePutDown = segRaw.map((x) => x === true || x === 'true')
  }
  const base: MultistopPlan = { destinations }
  if (pickupContinue) base.pickupContinue = pickupContinue
  if (segmentFirstNodePutDown) base.segmentFirstNodePutDown = segmentFirstNodePutDown
  return base
}

export type NormalizeDestinationResult =
  | { ok: true; dest: MultistopPlanDest }
  | { ok: false; error: string }

/** Validate API input for one destination row (POST/PATCH create mission). */
export function normalizeDestinationInput(o: Record<string, unknown>): NormalizeDestinationResult {
  const position = typeof o.position === 'string' ? o.position.trim() : ''
  const groupId = typeof o.groupId === 'string' ? o.groupId.trim() : ''
  if (!position && !groupId) return { ok: false, error: 'each destination needs position or groupId' }
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
    if (groupId) dest.groupId = groupId
    if (typeof o.putDown === 'boolean') dest.putDown = o.putDown
    return { ok: true, dest }
  }
  const dest: MultistopPlanDest = { position, passStrategy: 'AUTO', waitingMillis: 0, continueMode: 'manual' }
  if (groupId) dest.groupId = groupId
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

/** Build {@link MultistopPlan} from mission-template legs (pickup + destinations). */
/** Server → New Mission replay (same coarse shape as client template legs). */
export type ReplayMissionTemplateLeg = {
  position: string
  groupId?: string
  putDown: boolean
  segmentStartPutDown?: boolean
  continueMode?: ContinueMode
  autoContinueSeconds?: number
}

/**
 * Turn a persisted multistop `plan_json` + pickup stand into editable legs for the New Mission screen.
 */
export function multistopPlanToReplayLegs(pickupRaw: string, plan: MultistopPlan): ReplayMissionTemplateLeg[] | null {
  const pickup = pickupRaw.trim()
  if (!pickup) return null
  const dests = plan.destinations
  if (!Array.isArray(dests) || dests.length === 0) return null
  const pc = plan.pickupContinue
  const pickupMode: ContinueMode = pc?.continueMode === 'auto' ? 'auto' : 'manual'
  const pickupAuto =
    pickupMode === 'auto'
      ? Math.max(0, Math.min(MAX_AUTO_CONTINUE_SECONDS, Math.floor(pc?.autoContinueSeconds ?? 0)))
      : undefined
  const seg = plan.segmentFirstNodePutDown

  const legs: ReplayMissionTemplateLeg[] = [
    {
      position: pickup,
      putDown: false,
      continueMode: pickupMode,
      ...(pickupMode === 'auto' ? { autoContinueSeconds: pickupAuto ?? 0 } : {}),
      ...(Array.isArray(seg) && seg[0] === true ? { segmentStartPutDown: true } : {}),
    },
  ]

  for (let i = 0; i < dests.length; i++) {
    const d = dests[i]
    const isLast = i === dests.length - 1
    const gid = typeof d.groupId === 'string' ? d.groupId.trim() : ''
    const pos = typeof d.position === 'string' ? d.position.trim() : ''
    if (!pos && !gid) return null
    const destMode: ContinueMode = isLast ? 'manual' : d.continueMode === 'auto' ? 'auto' : 'manual'
    const leg: ReplayMissionTemplateLeg = {
      ...(gid ? { groupId: gid, position: pos } : { position: pos }),
      putDown: isLast ? true : Boolean(d.putDown),
      continueMode: destMode,
      ...(destMode === 'auto' && !isLast
        ? {
            autoContinueSeconds: Math.max(
              0,
              Math.min(MAX_AUTO_CONTINUE_SECONDS, Math.floor(d.autoContinueSeconds ?? 0))
            ),
          }
        : {}),
    }
    const destLegIdx = i + 1
    if (destLegIdx < dests.length && Array.isArray(seg) && seg[destLegIdx] === true) {
      leg.segmentStartPutDown = true
    }
    legs.push(leg)
  }
  return legs
}

export function multistopPlanFromTemplateLegs(
  legs: ReadonlyArray<{ position: string; putDown: boolean; segmentStartPutDown?: boolean }>
): MultistopPlan | null {
  if (legs.length < 2) return null
  const pickup = legs[0].position.trim()
  if (!pickup) return null
  const nd = legs.length - 1
  const destinations: MultistopPlanDest[] = []
  for (let i = 0; i < nd; i++) {
    const leg = legs[i + 1]
    const position = leg.position.trim()
    if (!position) return null
    destinations.push({
      position,
      passStrategy: 'AUTO',
      waitingMillis: 0,
      continueMode: 'manual',
      putDown: i === nd - 1 ? true : leg.putDown === true,
    })
  }
  const segmentFirstNodePutDown = legs.slice(0, nd).map((l) => l.segmentStartPutDown === true)
  return { destinations, segmentFirstNodePutDown }
}

/** Expand multistop plan to ordered (position, putDown) pairs for stand block validation — one pair per fleet NODE_POINT. */
export function multistopPlanToStandLegPairs(
  pickupRaw: string,
  plan: MultistopPlan
): Array<{ position: string; putDown: boolean }> {
  const dests = plan.destinations
  const n = dests.length
  const seg = plan.segmentFirstNodePutDown
  const pairs: Array<{ position: string; putDown: boolean }> = []
  const pickup = pickupRaw.trim()
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? null : dests[i - 1]
    const startPos = i === 0 ? pickup : (prev?.position ?? '').trim()
    const prevUnresolved = i > 0 && Boolean(prev?.groupId?.trim()) && !startPos
    const end = dests[i]
    const endPos = (end.position ?? '').trim()
    const endUnresolved = Boolean(end.groupId?.trim()) && !endPos
    if (prevUnresolved || endUnresolved) continue
    const startPut =
      Array.isArray(seg) && seg.length === n ? seg[i] === true : false
    const endPut = i === n - 1 ? true : end.putDown === true
    pairs.push({ position: startPos, putDown: startPut })
    pairs.push({ position: endPos, putDown: endPut })
  }
  return pairs
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
  const segStarts = plan.segmentFirstNodePutDown
  const startPutDown =
    Array.isArray(segStarts) && segStarts.length === total ? segStarts[segmentIndex] === true : false
  const startLeg = {
    sequence: 1,
    position: startPos,
    type: 'NODE_POINT',
    passStrategy: 'AUTO',
    waitingMillis: 0,
    putDown: startPutDown,
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

export type MultistopSegmentDropGate =
  | null
  | { kind: 'stand'; ref: string }
  | { kind: 'group'; groupId: string }

/**
 * Drop destination gate before releasing segment `nextSegmentIndex`, aligned with {@link buildSegmentMissionData}.
 * Includes segment 0 (same rule as later segments): empty-stand checks / queue gates run at Continue / worker release,
 * not only at mission create.
 */
export function multistopSegmentDropGate(plan: MultistopPlan, nextSegmentIndex: number): MultistopSegmentDropGate {
  const dests = plan.destinations
  const n = dests.length
  if (!Number.isFinite(nextSegmentIndex) || nextSegmentIndex < 0 || nextSegmentIndex >= n) return null
  const end = dests[nextSegmentIndex]
  const isFinal = nextSegmentIndex === n - 1
  const endPutDown = isFinal ? true : end.putDown === true
  if (!endPutDown) return null
  const gid = typeof end.groupId === 'string' ? end.groupId.trim() : ''
  const ref = (end.position ?? '').trim()
  if (ref) return { kind: 'stand', ref }
  if (gid) return { kind: 'group', groupId: gid }
  return null
}

/** @deprecated Prefer {@link multistopSegmentDropGate} for group support. */
export function multistopSegmentDropDestinationRef(
  plan: MultistopPlan,
  nextSegmentIndex: number
): string | null {
  const g = multistopSegmentDropGate(plan, nextSegmentIndex)
  return g?.kind === 'stand' ? g.ref : null
}

export function robotIdFromFleetJob(job: Record<string, unknown>): string {
  const id = job.robotId ?? job.robot_id
  return typeof id === 'string' ? id.trim() : ''
}
