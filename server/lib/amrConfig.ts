import type { AsyncDbWrapper } from '../db/schema.js'

export const AMR_FLEET_KV_KEY = 'amr.fleet.config'

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
