import type { AmrFleetCallLogContext } from './amrFleet.js'
import type { AmrHyperionConfig } from './hyperionConfig.js'
import { hyperionPostJson } from './hyperionClient.js'

function coercePresenceMap(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim()
    if (!key) continue
    if (typeof v === 'boolean') {
      out[key] = v
    } else if (v === 1 || v === 0) {
      out[key] = Boolean(v)
    } else if (typeof v === 'string') {
      const s = v.trim().toLowerCase()
      if (s === 'true' || s === '1') out[key] = true
      else if (s === 'false' || s === '0') out[key] = false
    }
  }
  return out
}

export async function fetchStandPresenceFromHyperion(
  cfg: AmrHyperionConfig,
  standIds?: string[],
  log?: AmrFleetCallLogContext
): Promise<{ ok: true; presence: Record<string, boolean> } | { ok: false; message: string; status?: number }> {
  const ids =
    Array.isArray(standIds) && standIds.length > 0
      ? standIds.map((s) => String(s).trim()).filter(Boolean)
      : undefined
  const body = ids && ids.length > 0 ? { standIds: ids } : {}

  const res = await hyperionPostJson<unknown>(cfg, '/stand-presence', body, log?.db ? { log } : undefined)
  if (!res.ok) {
    return {
      ok: false,
      message: res.text,
      status: res.status || 503,
    }
  }
  return { ok: true, presence: coercePresenceMap(res.json) }
}
