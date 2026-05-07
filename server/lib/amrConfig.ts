import type { AsyncDbWrapper } from '../db/schema.js'

export const AMR_FLEET_KV_KEY = 'amr.fleet.config'

/** Maps zones to ordered categories used for grouping zones in the stand picker. */
export type ZoneCategory = {
  /** Trimmed, non-empty, unique (case-insensitive) within the array. */
  name: string
  /** Zones assigned to this category, in display order. Each zone belongs to at most one category. */
  zones: string[]
}

export type AmrFleetConfig = {
  serverIp: string
  serverPort: number
  authKey: string
  useHttps: boolean
  orgId: string
  robotType: string
  robotModels: string[]
  robotIdsDefault: string[]
  containerType: string
  containerModelCode: string
  /** Client auto-refresh interval for the Missions list (and related in-app UI). */
  pollMsMissions: number
  /** Server mission worker: fleet `jobQuery` poll for open in-app mission records. */
  pollMsMissionWorker: number
  pollMsRobots: number
  pollMsContainers: number
  /**
   * Default for the missions page “fleet-complete” hide control when the browser has no local override.
   * `null` = do not hide by completion age (only the created-in-window rule applies).
   */
  hideFleetCompleteAfterMinutesDefault: number | null
  /**
   * When true (default), before creating a mission the app asks Hyperion and warns if stop 1 is empty while another stop reports a pallet.
   */
  missionCreateStandPresenceSanityCheck: boolean
  /** Master switch for queued mission dispatch / stand reservation flow. */
  missionQueueingEnabled: boolean
  /** Deadline window for post-lower pallet confirmation polling. */
  palletDropConfirmTimeoutMs: number
  /** Ordered zone categories (managed via Categories modal on the Stands screen). Empty by default. */
  zoneCategories: ZoneCategory[]
}

export const DEFAULT_AMR_FLEET_CONFIG: AmrFleetConfig = {
  serverIp: '',
  serverPort: 80,
  authKey: '',
  useHttps: false,
  orgId: 'DCAuto',
  robotType: 'LIFT',
  robotModels: ['KMP 600P-EU-D diffDrive', 'KMP 1500P-EU-D diffDrive'],
  robotIdsDefault: [],
  containerType: 'Tray(AMR)',
  containerModelCode: 'Pallet',
  pollMsMissions: 5000,
  pollMsMissionWorker: 5000,
  pollMsRobots: 5000,
  pollMsContainers: 5000,
  hideFleetCompleteAfterMinutesDefault: null,
  missionCreateStandPresenceSanityCheck: true,
  missionQueueingEnabled: true,
  palletDropConfirmTimeoutMs: 10000,
  zoneCategories: [],
}

/**
 * Normalize a `zoneCategories` array from arbitrary JSON: trim names, drop empty/duplicate names,
 * trim zones, and ensure each zone appears at most once across the entire array (last write wins).
 */
export function normalizeZoneCategories(raw: unknown): ZoneCategory[] {
  if (!Array.isArray(raw)) return []
  const out: ZoneCategory[] = []
  const seenNames = new Set<string>()
  const claimedZones = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    if (seenNames.has(key)) continue
    seenNames.add(key)
    const zonesIn = Array.isArray(o.zones) ? o.zones : []
    const zones: string[] = []
    const localZones = new Set<string>()
    for (const z of zonesIn) {
      if (typeof z !== 'string') continue
      const t = z.trim()
      if (!t) continue
      if (localZones.has(t)) continue
      if (claimedZones.has(t)) continue
      localZones.add(t)
      claimedZones.add(t)
      zones.push(t)
    }
    out.push({ name, zones })
  }
  return out
}

function mergeConfig(raw: unknown): AmrFleetConfig {
  const base = { ...DEFAULT_AMR_FLEET_CONFIG }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  if (typeof o.serverIp === 'string') base.serverIp = o.serverIp
  if (typeof o.serverPort === 'number' && Number.isFinite(o.serverPort)) base.serverPort = o.serverPort
  if (typeof o.authKey === 'string') base.authKey = o.authKey
  if (typeof o.useHttps === 'boolean') base.useHttps = o.useHttps
  if (typeof o.orgId === 'string') base.orgId = o.orgId
  if (typeof o.robotType === 'string') base.robotType = o.robotType
  if (Array.isArray(o.robotModels)) base.robotModels = o.robotModels.filter((x): x is string => typeof x === 'string')
  if (Array.isArray(o.robotIdsDefault))
    base.robotIdsDefault = o.robotIdsDefault.filter((x): x is string => typeof x === 'string')
  if (typeof o.containerType === 'string') base.containerType = o.containerType
  if (typeof o.containerModelCode === 'string') base.containerModelCode = o.containerModelCode
  if (typeof o.pollMsMissions === 'number' && o.pollMsMissions >= 1000) base.pollMsMissions = o.pollMsMissions
  if (typeof o.pollMsMissionWorker === 'number' && o.pollMsMissionWorker >= 1000)
    base.pollMsMissionWorker = o.pollMsMissionWorker
  else if (
    !('pollMsMissionWorker' in o) &&
    typeof o.pollMsMissions === 'number' &&
    o.pollMsMissions >= 1000
  ) {
    // Legacy: a single pollMsMissions value previously drove only the worker.
    base.pollMsMissionWorker = o.pollMsMissions
  }
  if (typeof o.pollMsRobots === 'number' && o.pollMsRobots >= 1000) base.pollMsRobots = o.pollMsRobots
  if (typeof o.pollMsContainers === 'number' && o.pollMsContainers >= 1000)
    base.pollMsContainers = o.pollMsContainers
  if ('hideFleetCompleteAfterMinutesDefault' in o) {
    const h = o.hideFleetCompleteAfterMinutesDefault
    if (h === null) base.hideFleetCompleteAfterMinutesDefault = null
    else if (typeof h === 'number' && h > 0 && Number.isFinite(h)) base.hideFleetCompleteAfterMinutesDefault = h
  }
  if (typeof o.missionCreateStandPresenceSanityCheck === 'boolean')
    base.missionCreateStandPresenceSanityCheck = o.missionCreateStandPresenceSanityCheck
  if (typeof o.missionQueueingEnabled === 'boolean') base.missionQueueingEnabled = o.missionQueueingEnabled
  if (typeof o.palletDropConfirmTimeoutMs === 'number' && Number.isFinite(o.palletDropConfirmTimeoutMs)) {
    const n = Math.floor(o.palletDropConfirmTimeoutMs)
    base.palletDropConfirmTimeoutMs = Math.max(1000, Math.min(600000, n))
  }
  if ('zoneCategories' in o) {
    base.zoneCategories = normalizeZoneCategories(o.zoneCategories)
  }
  return base
}

export async function getAmrFleetConfig(db: AsyncDbWrapper): Promise<AmrFleetConfig> {
  const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(AMR_FLEET_KV_KEY)) as
    | { value: string }
    | undefined
  if (!row?.value) return { ...DEFAULT_AMR_FLEET_CONFIG }
  try {
    return mergeConfig(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_AMR_FLEET_CONFIG }
  }
}

/** Persist config; omit or empty authKey leaves existing key unchanged. */
export async function saveAmrFleetConfig(
  db: AsyncDbWrapper,
  patch: Partial<AmrFleetConfig> & { authKey?: string }
): Promise<AmrFleetConfig> {
  const current = await getAmrFleetConfig(db)
  const next: AmrFleetConfig = { ...current, ...patch }
  if (patch.authKey === undefined || patch.authKey === '') {
    next.authKey = current.authKey
  }
  await db
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    .run(AMR_FLEET_KV_KEY, JSON.stringify(next))
  return next
}

/** Safe JSON for GET /settings (no raw auth key). */
export function publicAmrFleetConfig(cfg: AmrFleetConfig): Omit<AmrFleetConfig, 'authKey'> & {
  authKeyConfigured: boolean
} {
  const { authKey, ...rest } = cfg
  return {
    ...rest,
    authKeyConfigured: Boolean(authKey && authKey.trim().length > 0),
  }
}
