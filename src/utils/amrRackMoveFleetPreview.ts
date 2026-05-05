import { v4 as uuidv4 } from 'uuid'

import type { AmrFleetSettings } from '@/api/amr'

import { genDcaCode } from '@/utils/amrDcaCode'

/** Mirrors `buildFleetBaseUrl` in `server/lib/amrFleet.ts`. */
export function fleetDebugBaseUrl(settings: AmrFleetSettings): string | null {
  const ip = settings.serverIp?.trim()
  if (!ip) return null
  const port = Number(settings.serverPort)
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null
  const host = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip
  const proto = settings.useHttps ? 'https' : 'http'
  return `${proto}://${host}:${port}`
}

export function fleetOperationPostUrl(settings: AmrFleetSettings, operation: string): string | null {
  const base = fleetDebugBaseUrl(settings)
  if (!base) return null
  const op = operation.replace(/^\/+/, '')
  return `${base}/api/amr/${op}`
}

export type RackMoveFleetForwardStep = {
  /** Fleet REST operation name (same as server `forwardAmrFleetRequest`). */
  operation: 'containerIn' | 'submitMission'
  /** POST body JSON sent to the fleet (same object as server forwards). */
  payload: Record<string, unknown>
}

export type RackMoveFleetForwardPreview = {
  resolvedMissionCode: string
  resolvedContainerCode: string
  containerCodeWasGenerated: boolean
  missionCodeWasGenerated: boolean
  /** Server runs **containerIn** first; **submitMission** only if containerIn succeeds. */
  fleetForwardSteps: RackMoveFleetForwardStep[]
  notes: string[]
}

export type RackMoveFleetPreviewResult =
  | { ok: true; value: RackMoveFleetForwardPreview }
  | { ok: false; error: string }

/**
 * Best-effort preview of what `POST /amr/dc/missions/rack-move` causes the DC server to forward
 * to the fleet (see `server/routes/amr.ts`). `requestId` / generated codes use fresh values each call.
 */
export function buildRackMoveFleetForwardPreview(
  settings: AmrFleetSettings,
  body: Record<string, unknown>
): RackMoveFleetPreviewResult {
  const missionData = body.missionData
  if (!Array.isArray(missionData) || missionData.length === 0) {
    return { ok: false, error: 'missionData required (exactly 2 steps)' }
  }
  if (missionData.length !== 2) {
    return { ok: false, error: 'missionData must contain exactly 2 steps (use Add Stop for more)' }
  }
  const sorted = [...missionData].sort(
    (a: { sequence?: number }, b: { sequence?: number }) => (a.sequence ?? 0) - (b.sequence ?? 0)
  )
  const first = sorted[0] as { position?: string }
  if (!first?.position || typeof first.position !== 'string') {
    return { ok: false, error: 'missionData[0].position required' }
  }

  const missionCodeTrim =
    typeof body.missionCode === 'string' && body.missionCode.trim() ? body.missionCode.trim() : null
  const missionCode = missionCodeTrim ?? genDcaCode('RM')
  const missionCodeWasGenerated = missionCodeTrim === null

  const containerTrim =
    typeof body.containerCode === 'string' && body.containerCode.trim() ? body.containerCode.trim() : null
  const containerCode = containerTrim ?? uuidv4().replace(/-/g, '').slice(0, 16)
  const containerCodeWasGenerated = containerTrim === null

  const enterOrientation =
    typeof body.enterOrientation === 'string' && body.enterOrientation.trim()
      ? body.enterOrientation.trim()
      : '0'

  const ciPayload: Record<string, unknown> = {
    orgId: settings.orgId,
    requestId: genDcaCode('CI'),
    containerType: settings.containerType,
    containerModelCode: settings.containerModelCode,
    position: first.position,
    containerCode,
    enterOrientation,
    isNew: true,
  }

  const submitPayload: Record<string, unknown> = {
    orgId: settings.orgId,
    requestId: missionCode,
    missionCode,
    missionType: typeof body.missionType === 'string' ? body.missionType : 'RACK_MOVE',
    robotType: settings.robotType,
    lockRobotAfterFinish: typeof body.lockRobotAfterFinish === 'string' ? body.lockRobotAfterFinish : 'false',
    unlockRobotId: typeof body.unlockRobotId === 'string' ? body.unlockRobotId : '',
    robotModels: settings.robotModels,
    robotIds: Array.isArray(body.robotIds) ? body.robotIds : settings.robotIdsDefault,
    missionData: sorted,
    containerCode,
  }

  const notes: string[] = []
  if (missionCodeWasGenerated) {
    notes.push('If missionCode is omitted, the server generates a fresh DCA-RM-* code (preview uses one sample).')
  }
  if (containerCodeWasGenerated) {
    notes.push('If containerCode is omitted, the server generates a 16-character id (preview shows one sample).')
  }
  notes.push('containerIn requestId and generated codes differ on each server request; preview values are representative.')

  return {
    ok: true,
    value: {
      resolvedMissionCode: missionCode,
      resolvedContainerCode: containerCode,
      containerCodeWasGenerated,
      missionCodeWasGenerated,
      fleetForwardSteps: [
        { operation: 'containerIn', payload: ciPayload },
        { operation: 'submitMission', payload: submitPayload },
      ],
      notes,
    },
  }
}

/** Fleet ops the DC server can invoke — matches `forwardAmrFleetRequest` operation names. */
export type MultistopFleetTimelineOpName = 'containerIn' | 'submitMission' | 'jobQuery' | 'containerOut'

export type MultistopFleetTimelineOp = {
  op: MultistopFleetTimelineOpName
  description: string
  payload: Record<string, unknown>
  footnote?: string
}

export type MultistopFleetTimelinePhase = {
  key: string
  title: string
  trigger: string
  operations: MultistopFleetTimelineOp[]
}

export type MultistopFleetTimelineResult =
  | { ok: true; phases: MultistopFleetTimelinePhase[] }
  | { ok: false; error: string }

/** Mirrors `buildSegmentMissionData` in `server/lib/amrMultistop.ts`. */
function buildSegmentMissionDataPreview(
  pickupPosition: string,
  destinations: Array<{ position: string; passStrategy?: 'AUTO' | 'MANUAL'; waitingMillis?: number }>,
  segmentIndex: number
): Array<Record<string, unknown>> {
  const dests = destinations
  const total = dests.length
  if (segmentIndex < 0 || segmentIndex >= total) return []
  const startPos = segmentIndex === 0 ? pickupPosition.trim() : dests[segmentIndex - 1].position.trim()
  const end = dests[segmentIndex]
  const endPutDown = segmentIndex === total - 1
  return [
    {
      sequence: 1,
      position: startPos,
      type: 'NODE_POINT',
      passStrategy: 'AUTO',
      waitingMillis: 0,
      putDown: false,
    },
    {
      sequence: 2,
      position: end.position.trim(),
      type: 'NODE_POINT',
      passStrategy: 'AUTO',
      waitingMillis: 0,
      putDown: endPutDown,
    },
  ]
}

/**
 * Ordered list of DC-server → fleet calls for a multistop mission (create, each Continue, and worker).
 * Use for developer tooling; IDs and codes are representative samples.
 */
export function buildMultistopFleetTimeline(
  settings: AmrFleetSettings,
  args: {
    pickupPosition: string
    destinations: Array<{ position: string; passStrategy?: 'AUTO' | 'MANUAL'; waitingMillis?: number }>
    persistent: boolean
    robotIds?: string[]
  }
): MultistopFleetTimelineResult {
  const { pickupPosition, destinations, persistent, robotIds } = args
  if (destinations.length < 2) {
    return { ok: false, error: 'Add Stop needs at least two destinations (three or more stops).' }
  }
  const p = pickupPosition.trim()
  if (!p) return { ok: false, error: 'pickup position required' }
  for (const d of destinations) {
    if (!d.position?.trim()) return { ok: false, error: 'each destination needs a position' }
  }

  const rids = Array.isArray(robotIds) && robotIds.length > 0 ? robotIds : settings.robotIdsDefault

  const phases: MultistopFleetTimelinePhase[] = []
  const containerCode = uuidv4().replace(/-/g, '').slice(0, 16)
  const enterOrientation = '0'

  const ciPayload: Record<string, unknown> = {
    orgId: settings.orgId,
    requestId: genDcaCode('CI'),
    containerType: settings.containerType,
    containerModelCode: settings.containerModelCode,
    position: p,
    containerCode,
    enterOrientation,
    isNew: true,
  }

  const baseMissionCode = genDcaCode('RM')
  const missionCode0 = `${baseMissionCode}-1`
  const md0 = buildSegmentMissionDataPreview(p, destinations, 0)
  const submit0: Record<string, unknown> = {
    orgId: settings.orgId,
    requestId: missionCode0,
    missionCode: missionCode0,
    missionType: 'RACK_MOVE',
    robotType: settings.robotType,
    lockRobotAfterFinish: destinations.length > 1 ? 'true' : 'false',
    unlockRobotId: '',
    robotModels: settings.robotModels,
    robotIds: rids,
    missionData: md0,
    containerCode,
  }

  let stepNo = 1
  phases.push({
    key: 'create',
    title: `${stepNo} · Create session (POST /dc/missions/multistop)`,
    trigger:
      'Browser calls DC once; the server then calls the fleet: containerIn (once) → submitMission for segment 0.',
    operations: [
      {
        op: 'containerIn',
        description: 'Register the container at pickup (only on session create).',
        payload: ciPayload,
      },
      {
        op: 'submitMission',
        description: 'Segment 0: pickup → destinations[0].',
        payload: submit0,
        footnote:
          'missionCode / requestId share one base per session with segment suffixes -1, -2, … (samples shown).',
      },
    ],
  })
  stepNo += 1

  for (let seg = 1; seg < destinations.length; seg++) {
    const missionCode = `${baseMissionCode}-${seg + 1}`
    const md = buildSegmentMissionDataPreview(p, destinations, seg)
    const lockRobotAfterFinish = seg < destinations.length - 1 ? 'true' : 'false'
    const submit: Record<string, unknown> = {
      orgId: settings.orgId,
      requestId: missionCode,
      missionCode,
      missionType: 'RACK_MOVE',
      robotType: settings.robotType,
      lockRobotAfterFinish,
      unlockRobotId: '<robot id from session.locked_robot_id, else jobQuery on the prior job>',
      robotModels: settings.robotModels,
      robotIds: rids,
      missionData: md,
      containerCode,
    }

    phases.push({
      key: `continue-${seg}`,
      title: `${stepNo} · Continue segment ${seg} (POST …/multistop/{sessionId}/continue)`,
      trigger:
        'After the previous segment finishes, the worker sets the session to awaiting_continue; the operator (or automation) POSTs continue. No second containerIn — only optional jobQuery, then submitMission.',
      operations: [
        {
          op: 'jobQuery',
          description:
            'Optional — only if the session has no locked_robot_id; server resolves unlockRobotId from the previous job.',
          payload: { jobCode: '<prior segment job_code>' },
          footnote: 'Usually omitted: worker stores locked_robot_id when a segment reaches a successful terminal status.',
        },
        {
          op: 'submitMission',
          description: `Segment ${seg}: destinations[${seg - 1}] → destinations[${seg}].`,
          payload: submit,
        },
      ],
    })
    stepNo += 1
  }

  const lastIdx = destinations.length - 1
  phases.push({
    key: 'worker',
    title: `${stepNo} · Mission worker (background, every mission record)`,
    trigger:
      'Until the fleet reports a terminal status for each job, the worker polls jobQuery. containerOut runs only when appropriate.',
    operations: [
      {
        op: 'jobQuery',
        description: 'Poll fleet status for each open mission record jobCode.',
        payload: { jobCode: '<mission record job_code>' },
      },
      {
        op: 'containerOut',
        description: persistent
          ? 'Not called while persistentContainer is true.'
          : `After success (fleet status 30 or 35), removes the container at the job final node — skipped for non-final Add Stop segments (step index < ${lastIdx}).`,
        payload: {
          orgId: settings.orgId,
          requestId: 'DCA-CO-…',
          containerType: settings.containerType,
          containerModelCode: settings.containerModelCode,
          containerCode: '<session container_code>',
          position: '<mission final_position / last NODE_POINT>',
          enterOrientation: '0',
          isDelete: true,
        },
        footnote: persistent
          ? 'Persistent loads skip containerOut entirely.'
          : 'Intermediate (non-final) stops skip containerOut so the tote stays on the robot for the next Continue.',
      },
    ],
  })

  return { ok: true, phases }
}
