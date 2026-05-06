import type { AsyncDbWrapper } from '../db/schema.js'

export const AMR_HYPERION_KV_KEY = 'amr.hyperion.config'

export type AmrHyperionConfig = {
  /** Origin only, e.g. http://10.73.220.197:1881 (no trailing slash) */
  baseUrl: string
  username: string
  password: string
}

export const DEFAULT_AMR_HYPERION_CONFIG: AmrHyperionConfig = {
  baseUrl: '',
  username: '',
  password: '',
}

function mergeHyperion(raw: unknown): AmrHyperionConfig {
  const base = { ...DEFAULT_AMR_HYPERION_CONFIG }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  if (typeof o.baseUrl === 'string') base.baseUrl = o.baseUrl.trim()
  if (typeof o.username === 'string') base.username = o.username
  if (typeof o.password === 'string') base.password = o.password
  return base
}

export async function getAmrHyperionConfig(db: AsyncDbWrapper): Promise<AmrHyperionConfig> {
  const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(AMR_HYPERION_KV_KEY)) as
    | { value: string }
    | undefined
  if (!row?.value) return { ...DEFAULT_AMR_HYPERION_CONFIG }
  try {
    return mergeHyperion(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_AMR_HYPERION_CONFIG }
  }
}

export async function saveAmrHyperionConfig(
  db: AsyncDbWrapper,
  patch: Partial<AmrHyperionConfig> & { password?: string }
): Promise<AmrHyperionConfig> {
  const current = await getAmrHyperionConfig(db)
  const next: AmrHyperionConfig = {
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : current.baseUrl,
    username: patch.username !== undefined ? patch.username : current.username,
    password: current.password,
  }
  if (patch.baseUrl !== undefined) next.baseUrl = String(patch.baseUrl).trim()
  if (patch.username !== undefined) next.username = patch.username
  if (patch.password !== undefined && patch.password !== '') {
    next.password = patch.password
  }
  await db
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    .run(AMR_HYPERION_KV_KEY, JSON.stringify(next))
  return next
}

export type PublicAmrHyperionConfig = {
  hyperionBaseUrl: string
  hyperionUsername: string
  hyperionPasswordConfigured: boolean
}

export function publicAmrHyperionConfig(cfg: AmrHyperionConfig): PublicAmrHyperionConfig {
  return {
    hyperionBaseUrl: cfg.baseUrl,
    hyperionUsername: cfg.username,
    hyperionPasswordConfigured: Boolean(cfg.password && cfg.password.length > 0),
  }
}

export function hyperionConfigured(cfg: AmrHyperionConfig): boolean {
  const u = cfg.username.trim()
  const p = cfg.password
  const b = cfg.baseUrl.trim()
  return Boolean(b && u && p && p.length > 0)
}
