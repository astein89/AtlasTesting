import type { AmrStandPickerRow } from '@/components/amr/AmrStandPickerModal'
import { enterOrientationForStandRef } from '@/components/amr/AmrStandPickerModal'

/** Matches server {@link AmrMissionTemplatePayloadV1}. */

export type AmrMissionTemplatePayloadV1 = {
  version: 1
  legs: Array<{
    position: string
    putDown: boolean
    continueMode?: 'manual' | 'auto'
    autoContinueSeconds?: number
  }>
  persistentContainer: boolean
  robotIds: string[]
  containerCode?: string
}

export function missionFormToTemplatePayload(
  legs: Array<{
    position: string
    putDown: boolean
    continueMode?: 'manual' | 'auto'
    autoContinueSeconds?: number
  }>,
  persistent: boolean,
  selectedRobotIds: string[],
  containerCode: string
): AmrMissionTemplatePayloadV1 {
  return {
    version: 1,
    legs: legs.map((l) => {
      const cm = l.continueMode === 'auto' ? 'auto' : 'manual'
      const base = {
        position: l.position.trim(),
        putDown: l.putDown,
        continueMode: cm as 'manual' | 'auto',
      }
      if (cm === 'auto') {
        const s = Math.max(0, Math.min(86400, Math.floor(l.autoContinueSeconds ?? 0)))
        return { ...base, autoContinueSeconds: s }
      }
      return base
    }),
    persistentContainer: persistent,
    robotIds: selectedRobotIds.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()),
    ...(containerCode.trim() ? { containerCode: containerCode.trim() } : {}),
  }
}

/** Same rules as {@link validateNewMissionForm} in `AmrMissionNew.tsx` (locations + auto-release seconds). */
export function validateMissionTemplatePayloadForCreate(
  payload: AmrMissionTemplatePayloadV1
): { ok: true } | { ok: false; message: string } {
  const legs = payload.legs ?? []
  if (legs.length < 2) {
    return { ok: false, message: 'Template needs at least two stops.' }
  }
  const missingLoc: number[] = []
  for (let i = 0; i < legs.length; i++) {
    if (!legs[i].position.trim()) missingLoc.push(i)
  }
  if (missingLoc.length > 0) {
    const stops = missingLoc.map((i) => i + 1).join(', ')
    return {
      ok: false,
      message:
        missingLoc.length === 1
          ? `Stop ${missingLoc[0] + 1} needs a location (External Ref).`
          : `Every stop needs a location (External Ref). Missing: stops ${stops}.`,
    }
  }
  for (let idx = 0; idx < legs.length - 1; idx++) {
    const leg = legs[idx]
    if (leg.continueMode === 'auto') {
      const s = leg.autoContinueSeconds ?? 0
      if (!Number.isFinite(s) || s < 0 || s > 86400) {
        return {
          ok: false,
          message: `Stop ${idx + 1}: Auto Release needs 0–86400 seconds.`,
        }
      }
    }
  }
  return { ok: true }
}

/**
 * POST body for {@link createMultistopMission} — mirrors `buildMultistopPayload` in `AmrMissionNew.tsx`.
 */
export function templatePayloadToMultistopBody(
  payload: AmrMissionTemplatePayloadV1,
  stands: AmrStandPickerRow[]
): Record<string, unknown> {
  const legs = payload.legs
  const pickupPosition = legs[0]?.position.trim() ?? ''
  const enterOrientation = enterOrientationForStandRef(stands, pickupPosition)
  const destLegs = legs.slice(1)
  const pickupLeg = legs[0]
  const pickupContinue: Record<string, unknown> =
    pickupLeg?.continueMode === 'auto'
      ? {
          continueMode: 'auto',
          autoContinueSeconds: Math.max(
            0,
            Math.min(Math.floor(pickupLeg.autoContinueSeconds ?? 0), 86400)
          ),
        }
      : { continueMode: 'manual' }
  const destinations = destLegs.map((l, i) => {
    const isLast = i === destLegs.length - 1
    const cm = legs[i + 1] ?? l
    const mode = isLast ? 'manual' : (cm.continueMode ?? 'manual')
    const base = {
      position: l.position.trim(),
      passStrategy: 'AUTO' as const,
      waitingMillis: 0,
      continueMode: mode,
      putDown: l.putDown,
    }
    if (mode === 'auto') {
      const sec = Math.max(0, Math.min(Math.floor(cm.autoContinueSeconds ?? 0), 86400))
      return { ...base, autoContinueSeconds: sec }
    }
    return base
  })
  const out: Record<string, unknown> = {
    pickupPosition,
    pickupContinue,
    destinations,
    persistentContainer: payload.persistentContainer,
    enterOrientation,
  }
  const cc = payload.containerCode?.trim()
  if (cc) out.containerCode = cc
  const robotIds = (payload.robotIds ?? []).filter((x) => typeof x === 'string' && x.trim())
  if (robotIds.length > 0) out.robotIds = robotIds
  return out
}
