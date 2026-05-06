import type { AmrFleetCallLogContext } from './amrFleet.js'
import { persistFleetApiLog } from './amrFleet.js'
import type { AmrHyperionConfig } from './hyperionConfig.js'

const DEFAULT_TIMEOUT_MS = 15_000

function normalizeOrigin(baseUrl: string): string {
  const t = baseUrl.trim()
  if (!t) return ''
  try {
    const u = new URL(t.endsWith('/') ? t.slice(0, -1) : t)
    return u.origin
  } catch {
    return ''
  }
}

/** POST JSON to Hyperion under configured origin + path (leading slash). */
export async function hyperionPostJson<T>(
  cfg: AmrHyperionConfig,
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number; log?: AmrFleetCallLogContext }
): Promise<{ ok: true; status: number; json: T } | { ok: false; status: number; text: string }> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = opts?.log
  const rel = path.startsWith('/') ? path : `/${path}`
  const operation = `Hyperion POST ${rel}`

  const maybeLog = async (httpStatus: number, responseBody: unknown) => {
    if (log?.db) {
      await persistFleetApiLog(log, operation, httpStatus, body, responseBody)
    }
  }

  const origin = normalizeOrigin(cfg.baseUrl)
  if (!origin) {
    return { ok: false, status: 0, text: 'Hyperion base URL not configured' }
  }
  let url: URL
  try {
    url = new URL(rel, `${origin}/`)
  } catch {
    return { ok: false, status: 0, text: 'Invalid Hyperion base URL' }
  }
  const user = cfg.username.trim()
  const pass = cfg.password
  if (!user || !pass) {
    return { ok: false, status: 0, text: 'Hyperion credentials not configured' }
  }
  const basic = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify(body ?? {}),
      signal: ac.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const snippet = text.slice(0, 2000) || res.statusText
      await maybeLog(res.status, { ok: false, bodySnippet: snippet })
      return { ok: false, status: res.status, text: snippet }
    }
    try {
      const json = JSON.parse(text) as T
      await maybeLog(res.status, json)
      return { ok: true, status: res.status, json }
    } catch {
      await maybeLog(res.status, { ok: false, error: 'Invalid JSON from Hyperion', raw: text.slice(0, 8000) })
      return { ok: false, status: res.status, text: 'Invalid JSON from Hyperion' }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('abort') || msg === 'The operation was aborted.') {
      await maybeLog(502, { ok: false, error: `Hyperion request timed out after ${timeoutMs}ms` })
      return { ok: false, status: 0, text: `Hyperion request timed out after ${timeoutMs}ms` }
    }
    await maybeLog(502, { ok: false, error: msg || 'Hyperion request failed' })
    return { ok: false, status: 0, text: msg || 'Hyperion request failed' }
  } finally {
    clearTimeout(t)
  }
}
