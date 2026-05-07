import { api } from './client'
import type { AmrMissionTemplatePayloadV1 } from '@/utils/amrMissionTemplate'

/** Maps a category name to an ordered list of zone names. Stored on AMR fleet config. */
export type ZoneCategory = {
  name: string
  zones: string[]
}

/** Picker context used to filter stands whose `block_pickup` / `block_dropoff` would forbid the chosen step. */
export type AmrStandPickerMode = 'pickup' | 'dropoff' | 'any'

/** Row shape returned by `GET /dc/stands` (kept loose for forward-compat with extra fields). */
export type AmrStandRow = {
  id: string
  zone: string
  location_label: string
  external_ref: string
  dwg_ref: string | null
  orientation: string
  x: number
  y: number
  enabled: number
  /** 0 = allowed; 1 = "no lift" (cannot pickup at this stand). */
  block_pickup: number
  /** 0 = allowed; 1 = "no lower" (cannot dropoff at this stand). */
  block_dropoff: number
  /** 0 = normal; 1 = skip Hyperion empty-stand checks for this location (create / continue). */
  bypass_pallet_check: number
  /** Max active queued/reserved dispatches for bypass-pallet-check stands (default 1). */
  active_missions: number
  /** `stand` | `non_stand` waypoint — see AMR Positions docs / server `amr_stands.location_type`. */
  location_type?: string
  created_at: string | null
  updated_at: string | null
  [extra: string]: unknown
}

export type AmrFleetSettings = {
  serverIp: string
  serverPort: number
  authKeyConfigured: boolean
  useHttps: boolean
  orgId: string
  robotType: string
  robotModels: string[]
  robotIdsDefault: string[]
  containerType: string
  containerModelCode: string
  pollMsMissions: number
  /** Present after server adds split worker vs UI poll; falls back to pollMsMissions if absent. */
  pollMsMissionWorker?: number
  pollMsRobots: number
  pollMsContainers: number
  /** Missions page default for hiding fleet-complete rows when no browser-local choice exists. */
  hideFleetCompleteAfterMinutesDefault?: number | null
  /**
   * When true (default if omitted), New mission / template create calls Hyperion and may prompt if stop 1 is empty while another stop has a pallet.
   */
  missionCreateStandPresenceSanityCheck?: boolean
  missionQueueingEnabled?: boolean
  /** Toast duration after a mission is created in queued state (ms). Server default 10000; clamped 2000–120000. */
  missionQueuedToastDismissMs?: number
  palletDropConfirmTimeoutMs?: number
  /**
   * After a successful drop with queueing enabled, poll Hyperion and may surface presence warnings unless false (default true if omitted).
   */
  postDropPresenceWarningCheck?: boolean
  /** Hyperion API origin (e.g. http://host:1881). Used for stand presence and future Hyperion proxies. */
  hyperionBaseUrl?: string
  hyperionUsername?: string
  hyperionPasswordConfigured?: boolean
  /** Ordered zone categories used to group the stand picker zone list. */
  zoneCategories?: ZoneCategory[]
  /**
   * When omitted from stored settings: legacy behavior — exactly two-stand zones show both stands on the zone step.
   * When set (including empty array): manual list — only those zone keys expand on the zone step for any stand count.
   */
  zonePickerInlineZones?: string[]
}

/** App mission records — match server mission worker cadence (`pollMsMissionWorker`, else `pollMsMissions`). */
export function pollMsAlignedWithMissionWorker(settings: AmrFleetSettings): number {
  return Math.max(1000, settings.pollMsMissionWorker ?? settings.pollMsMissions)
}

/** Fleet job list on the missions page (`jobQuery`) — uses the missions UI interval only. */
export function pollMsMissionsUi(settings: AmrFleetSettings): number {
  return Math.max(1000, settings.pollMsMissions)
}

export async function getAmrSettings() {
  const { data } = await api.get<AmrFleetSettings>('/amr/dc/settings')
  return data
}

export async function putAmrSettings(
  body: Omit<Partial<AmrFleetSettings>, 'zonePickerInlineZones'> & {
    authKey?: string
    hyperionPassword?: string
    zonePickerInlineZones?: string[] | null
  }
) {
  const { data } = await api.put<AmrFleetSettings>('/amr/dc/settings', body)
  return data
}

/** Batch stand presence from Hyperion via DC proxy. Pass explicit refs (may be empty → empty map). */
export async function postStandPresence(standIds: string[]) {
  const { data } = await api.post<{ presence: Record<string, boolean> }>('/amr/dc/stands/presence', {
    standIds,
  })
  return data.presence
}

export async function testAmrFleetConnection() {
  const { data } = await api.post<unknown>('/amr/dc/fleet/test')
  return data
}

export type AmrHyperionTestResult = {
  ok: true
  message: string
  presenceEntryCount: number
}

export async function testAmrHyperionConnection() {
  const { data } = await api.post<AmrHyperionTestResult>('/amr/dc/hyperion/test')
  return data
}

export async function amrFleetProxy(operation: string, payload: unknown) {
  const { data } = await api.post<unknown>('/amr/dc/fleet', { operation, payload })
  return data
}

export async function getAmrStands() {
  const { data } = await api.get<{ stands: Record<string, unknown>[] }>('/amr/dc/stands')
  return data.stands
}

/** Per-robot lock metadata stored in `amr_robots`. Locked robots are excluded from `submitMission.robotIds`. */
export type AmrRobotLockRow = {
  robotId: string
  locked: boolean
  /** ISO timestamp set when the robot was locked; cleared on unlock. */
  lockedAt: string | null
  /** User id that flipped the lock on. */
  lockedBy: string | null
  notes: string | null
}

/** Returns every persisted lock row (locked + previously-touched). Active fleet rows come from `robotQuery`. */
export async function listAmrRobotLocks() {
  const { data } = await api.get<{ robots: AmrRobotLockRow[] }>('/amr/robots')
  return data.robots
}

/** Sets / clears the lock flag on a robot. Locking blocks new fleet `submitMission` assignment. */
export async function setAmrRobotLock(
  robotId: string,
  body: { locked: boolean; notes?: string | null }
) {
  const { data } = await api.put<{ robot: AmrRobotLockRow }>(
    `/amr/robots/${encodeURIComponent(robotId)}/lock`,
    body
  )
  return data.robot
}

export async function createAmrStand(body: Record<string, unknown>) {
  const { data } = await api.post<Record<string, unknown>>('/amr/dc/stands', body)
  return data
}

export async function updateAmrStand(id: string, body: Record<string, unknown>) {
  const { data } = await api.patch<Record<string, unknown>>(`/amr/dc/stands/${id}`, body)
  return data
}

export async function deleteAmrStand(id: string) {
  await api.delete(`/amr/dc/stands/${id}`)
}

export type AmrStandImportFailure = { line: number; external_ref: string | null; reason: string }

export async function importAmrStandsCsv(csv: string) {
  const { data } = await api.post<{ imported: number; failures: AmrStandImportFailure[] }>(
    '/amr/dc/stands/import',
    { csv }
  )
  return data
}

/** Synthetic zone key / mission sentinel prefix for stand groups (`__group:<uuid>`). */
export const AMR_STAND_GROUP_PREFIX = '__group:'

export type AmrStandGroupMember = {
  standId: string
  externalRef: string
  position: number
}

export type AmrStandGroupRow = {
  id: string
  name: string
  zone: string
  enabled: number
  sort_order: number
  members: AmrStandGroupMember[]
}

export async function getAmrStandGroups() {
  const { data } = await api.get<{ groups: AmrStandGroupRow[] }>('/amr/dc/stand-groups')
  return data.groups
}

export async function createAmrStandGroup(body: {
  name: string
  memberStandIds?: string[]
  sort_order?: number
}) {
  const { data } = await api.post<{ group: Record<string, unknown> }>('/amr/dc/stand-groups', body)
  return data.group
}

export async function updateAmrStandGroup(
  id: string,
  body: Partial<{ name: string; enabled: boolean; sort_order: number; memberStandIds: string[] }>
) {
  const { data } = await api.patch<{ group: Record<string, unknown> }>(`/amr/dc/stand-groups/${encodeURIComponent(id)}`, body)
  return data.group
}

export async function deleteAmrStandGroup(id: string) {
  await api.delete(`/amr/dc/stand-groups/${encodeURIComponent(id)}`)
}

export async function getAmrMissionRecords(options?: { signal?: AbortSignal }) {
  const { data } = await api.get<{ records: Record<string, unknown>[] }>('/amr/dc/mission-records', {
    signal: options?.signal,
  })
  return data.records
}

/** Same shape as {@link AmrMissionTemplatePayloadV1}; used to prefill New Mission from a historical record. */
export type AmrMissionReplayPayload = {
  version: 1
  legs: Array<{
    position: string
    groupId?: string
    putDown: boolean
    segmentStartPutDown?: boolean
    continueMode?: 'manual' | 'auto'
    autoContinueSeconds?: number
  }>
  persistentContainer: boolean
  robotIds?: string[]
  containerCode?: string
}

export async function getAmrMissionReplayPayload(missionRecordId: string, options?: { signal?: AbortSignal }) {
  const { data } = await api.get<AmrMissionReplayPayload>(
    `/amr/dc/mission-records/${encodeURIComponent(missionRecordId)}/replay`,
    { signal: options?.signal }
  )
  return data
}

export type AmrMissionAttentionItem = {
  sessionId: string
  /** Current-segment display code (e.g. DCA-RM-…-1), derived from base + next segment index. */
  missionCode: string
  status: string
  pickupPosition: string
  containerCode: string | null
  nextSegmentIndex: number
  totalSegments: number
  updatedAt: string | null
  /** ISO time when auto-continue runs; null if manual wait or not scheduled. */
  continueNotBefore: string | null
}

export async function getAmrMissionAttention(options?: { signal?: AbortSignal }) {
  const { data } = await api.get<{ count: number; items: AmrMissionAttentionItem[] }>('/amr/dc/missions/attention', {
    signal: options?.signal,
  })
  return data
}

export async function getAmrMissionLog(options?: { signal?: AbortSignal }) {
  const { data } = await api.get<{ entries: Record<string, unknown>[] }>('/amr/dc/mission-log', {
    signal: options?.signal,
  })
  return data.entries
}

export async function getAmrFleetApiLog(options?: { signal?: AbortSignal }) {
  const { data } = await api.get<{ entries: Record<string, unknown>[] }>('/amr/dc/fleet-api-log', {
    signal: options?.signal,
  })
  return data.entries
}

export const AMR_RACK_MOVE_MISSION_PATH = '/amr/dc/missions/rack-move'
export const AMR_MULTISTOP_MISSION_PATH = '/amr/dc/missions/multistop'

export async function createRackMoveMission(body: Record<string, unknown>) {
  const { data } = await api.post<unknown>(AMR_RACK_MOVE_MISSION_PATH, body)
  return data
}

export async function createMultistopMission(body: Record<string, unknown>) {
  const { data } = await api.post<unknown>(AMR_MULTISTOP_MISSION_PATH, body)
  return data
}

export async function getAmrMultistopSession(sessionId: string) {
  const { data } = await api.get<{ session: Record<string, unknown>; records: Record<string, unknown>[] }>(
    `/amr/dc/missions/multistop/${encodeURIComponent(sessionId)}`
  )
  return data
}

export async function patchAmrMultistopSession(sessionId: string, body: Record<string, unknown>) {
  const { data } = await api.patch<unknown>(`/amr/dc/missions/multistop/${encodeURIComponent(sessionId)}`, body)
  return data
}

export async function continueAmrMultistopSession(
  sessionId: string,
  opts?: { forceRelease?: boolean }
) {
  const body: Record<string, boolean> = {}
  if (opts?.forceRelease) body.forceRelease = true
  const { data } = await api.post<unknown>(
    `/amr/dc/missions/multistop/${encodeURIComponent(sessionId)}/continue`,
    body
  )
  return data
}

export async function forceReleaseMission(missionRecordId: string) {
  const { data } = await api.post<{ ok: boolean; missionRecordId: string; fleetSubmit: unknown }>(
    `/amr/dc/missions/${encodeURIComponent(missionRecordId)}/force-release`,
    {}
  )
  return data
}

export async function ackPresenceWarning(missionRecordId: string) {
  const { data } = await api.post<{ ok: boolean; missionRecordId: string }>(
    `/amr/dc/missions/${encodeURIComponent(missionRecordId)}/ack-presence-warning`,
    {}
  )
  return data
}

/** Abandon multistop before first fleet submitMission (deferred segment 0): fleet containerOut + session cancelled. */
export async function cancelAmrMultistopSession(sessionId: string) {
  const { data } = await api.delete<{ ok: boolean; sessionId: string; status: string }>(
    `/amr/dc/missions/multistop/${encodeURIComponent(sessionId)}`
  )
  return data
}

export type TerminateStuckMultistopFleetCancel = {
  missionCode: string
  ok: boolean
  httpStatus: number
  fleetSuccess?: boolean
}

/** Failed multistop: best-effort fleet missionCancel per leg + mark session cancelled and close local tracking. */
export async function terminateStuckAmrMultistopSession(sessionId: string) {
  const { data } = await api.post<{
    ok: boolean
    sessionId: string
    status: string
    fleetCancels: TerminateStuckMultistopFleetCancel[]
    fleetContainerOut?: {
      ok: boolean
      httpStatus: number
      fleetSuccess?: boolean
      position?: string
    }
  }>(`/amr/dc/missions/multistop/${encodeURIComponent(sessionId)}/terminate-stuck`, {})
  return data
}

export type AmrMissionTemplateListItem = {
  id: string
  name: string
  stopCount: number
  /** Up to 3 lines: `externalRef · Pickup|Drop`, or two such lines plus "+ N more" when there are more than 3 stops. */
  stopLines: string[]
  /** Robot IDs saved on the template for fleet targeting (empty if none). */
  robotIds: string[]
  createdAt: string | null
  updatedAt: string | null
  createdByUsername: string | null
}

export async function listAmrMissionTemplates(options?: { signal?: AbortSignal }) {
  const { data } = await api.get<{ templates: AmrMissionTemplateListItem[] }>('/amr/dc/mission-templates', {
    signal: options?.signal,
  })
  return data.templates
}

export type AmrMissionTemplateDetail = {
  id: string
  name: string
  payload: AmrMissionTemplatePayloadV1
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  createdByUsername: string | null
}

export async function getAmrMissionTemplate(id: string, options?: { signal?: AbortSignal }) {
  const { data } = await api.get<{ template: AmrMissionTemplateDetail }>(
    `/amr/dc/mission-templates/${encodeURIComponent(id)}`,
    { signal: options?.signal }
  )
  return data.template
}

export async function createAmrMissionTemplate(body: {
  name: string
  payload: AmrMissionTemplatePayloadV1
  /** When true, allow legs that violate stand block flags (requires `amr.stands.override-special`). */
  override?: boolean
}) {
  const { data } = await api.post<{
    id: string
    name: string
    payload: AmrMissionTemplatePayloadV1
    createdAt: string
    updatedAt: string
  }>('/amr/dc/mission-templates', body)
  return data
}

export async function updateAmrMissionTemplate(
  id: string,
  body: Partial<{ name: string; payload: AmrMissionTemplatePayloadV1 }> & { override?: boolean }
) {
  const { data } = await api.put<{
    id: string
    name: string
    payload: AmrMissionTemplatePayloadV1
    updatedAt: string
  }>(`/amr/dc/mission-templates/${encodeURIComponent(id)}`, body)
  return data
}

export async function deleteAmrMissionTemplate(id: string) {
  const { data } = await api.delete<{ ok: boolean }>(
    `/amr/dc/mission-templates/${encodeURIComponent(id)}`
  )
  return data
}
