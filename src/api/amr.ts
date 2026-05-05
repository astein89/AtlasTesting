import { api } from './client'

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

export async function putAmrSettings(body: Partial<AmrFleetSettings> & { authKey?: string }) {
  const { data } = await api.put<AmrFleetSettings>('/amr/dc/settings', body)
  return data
}

export async function testAmrFleetConnection() {
  const { data } = await api.post<unknown>('/amr/dc/fleet/test')
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

export async function getAmrMissionRecords(options?: { signal?: AbortSignal }) {
  const { data } = await api.get<{ records: Record<string, unknown>[] }>('/amr/dc/mission-records', {
    signal: options?.signal,
  })
  return data.records
}

export type AmrMissionAttentionItem = {
  sessionId: string
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

export async function continueAmrMultistopSession(sessionId: string) {
  const { data } = await api.post<unknown>(
    `/amr/dc/missions/multistop/${encodeURIComponent(sessionId)}/continue`,
    {}
  )
  return data
}
