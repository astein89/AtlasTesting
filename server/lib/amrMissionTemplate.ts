/**
 * Org-wide AMR mission templates: validate JSON payload (mirrors client mission form rules).
 */

export type AmrMissionTemplateLeg = {
  position: string
  putDown: boolean
  /** First NODE_POINT of the segment leaving this stop: drop (true) vs no drop (false). Omitted on last stop. */
  segmentStartPutDown?: boolean
  continueMode?: 'manual' | 'auto'
  autoContinueSeconds?: number
}

export type AmrMissionTemplatePayloadV1 = {
  version: 1
  legs: AmrMissionTemplateLeg[]
  persistentContainer: boolean
  robotIds: string[]
  containerCode?: string
}

export function validateMissionTemplatePayload(raw: unknown):
  | { ok: true; payload: AmrMissionTemplatePayloadV1 }
  | { ok: false; error: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'payload must be an object' }
  }
  const o = raw as Record<string, unknown>
  if (o.version !== 1) {
    return { ok: false, error: 'payload.version must be 1' }
  }
  if (!Array.isArray(o.legs)) {
    return { ok: false, error: 'payload.legs must be an array' }
  }
  if (o.legs.length < 2) {
    return { ok: false, error: 'At least two stops are required' }
  }
  const legs: AmrMissionTemplateLeg[] = []
  for (let i = 0; i < o.legs.length; i++) {
    const row = o.legs[i]
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `legs[${i}] must be an object` }
    }
    const L = row as Record<string, unknown>
    const position = typeof L.position === 'string' ? L.position.trim() : ''
    if (!position) {
      return { ok: false, error: `Stop ${i + 1} needs a location (External Ref)` }
    }
    const putDown = Boolean(L.putDown)
    const isLast = i === o.legs.length - 1
    const cmRaw = L.continueMode === 'auto' ? 'auto' : 'manual'
    const cm = isLast ? 'manual' : cmRaw
    let autoContinueSeconds: number | undefined
    if (cm === 'auto') {
      const s =
        typeof L.autoContinueSeconds === 'number'
          ? L.autoContinueSeconds
          : Number(L.autoContinueSeconds)
      if (!Number.isFinite(s) || s < 0 || s > 86400) {
        return { ok: false, error: `Stop ${i + 1}: Auto Release needs 0–86400 seconds` }
      }
      autoContinueSeconds = Math.floor(s)
    }
    const segmentStartPutDown =
      !isLast && (L.segmentStartPutDown === true || L.segmentStartPutDown === 'true')
    legs.push({
      position,
      putDown,
      ...(segmentStartPutDown ? { segmentStartPutDown: true } : {}),
      continueMode: cm,
      ...(cm === 'auto' ? { autoContinueSeconds } : {}),
    })
  }

  const persistentContainer = Boolean(o.persistentContainer)
  const robotIdsRaw = o.robotIds
  if (!Array.isArray(robotIdsRaw)) {
    return { ok: false, error: 'robotIds must be an array' }
  }
  const robotIds: string[] = []
  for (const x of robotIdsRaw) {
    if (typeof x === 'string' && x.trim()) robotIds.push(x.trim())
  }

  let containerCode: string | undefined
  if (o.containerCode != null) {
    if (typeof o.containerCode !== 'string') {
      return { ok: false, error: 'containerCode must be a string' }
    }
    const t = o.containerCode.trim()
    containerCode = t || undefined
  }

  const payload: AmrMissionTemplatePayloadV1 = {
    version: 1,
    legs,
    persistentContainer,
    robotIds,
    ...(containerCode ? { containerCode } : {}),
  }
  return { ok: true, payload }
}

export function stopCountFromPayloadJson(payloadJson: string): number {
  try {
    const o = JSON.parse(payloadJson) as { legs?: unknown }
    if (!Array.isArray(o.legs)) return 0
    return o.legs.length
  } catch {
    return 0
  }
}

function formatTemplateStopCardLine(leg: AmrMissionTemplateLeg): string {
  const op = leg.putDown ? 'Drop' : 'Pickup'
  return `${leg.position} · ${op}`
}

/** List API: one parse; up to 3 lines (`position · Pickup|Drop`), or first two plus "+ N more". */
export function templateListCardFieldsFromPayloadJson(payloadJson: string): {
  stopCount: number
  stopLines: string[]
  robotIds: string[]
} {
  try {
    const v = validateMissionTemplatePayload(JSON.parse(payloadJson))
    if (!v.ok) {
      return { stopCount: stopCountFromPayloadJson(payloadJson), stopLines: [], robotIds: [] }
    }
    const legs = v.payload.legs
    const n = legs.length
    const stopLines =
      n <= 3
        ? legs.map(formatTemplateStopCardLine)
        : [formatTemplateStopCardLine(legs[0]!), formatTemplateStopCardLine(legs[1]!), `+ ${n - 2} more`]
    return { stopCount: n, stopLines, robotIds: v.payload.robotIds }
  } catch {
    return { stopCount: stopCountFromPayloadJson(payloadJson), stopLines: [], robotIds: [] }
  }
}
