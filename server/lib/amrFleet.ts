import { v4 as uuidv4 } from 'uuid'

import type { AsyncDbWrapper } from '../db/schema.js'

import type { AmrFleetConfig } from './amrConfig.js'
import { formatLogRecordedAt } from './hostTimeZone.js'



const FLEET_TIMEOUT_MS = 30_000



export type FleetForwardResult = {

  ok: boolean

  status: number

  json: unknown

  text?: string

}



/** When set, each fleet round-trip is appended to `amr_fleet_api_log`. */

export type AmrFleetCallLogContext = {

  db: AsyncDbWrapper

  source: string

  missionRecordId?: string | null

  userId?: string | null

}



function buildFleetBaseUrl(cfg: AmrFleetConfig): string | null {

  const ip = cfg.serverIp?.trim()

  if (!ip) return null

  const port = Number(cfg.serverPort)

  if (!Number.isFinite(port) || port < 1 || port > 65535) return null

  const host = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip

  const proto = cfg.useHttps ? 'https' : 'http'

  return `${proto}://${host}:${port}`

}



function truncateJsonBlob(obj: unknown, maxChars = 52000): string {

  try {

    const s = JSON.stringify(obj ?? null)

    return s.length <= maxChars ? s : s.slice(0, maxChars) + '\n…[truncated]'

  } catch {

    return '[unserializable]'

  }

}



/** Append one row to `amr_fleet_api_log` (also used for Hyperion proxy calls). */
export async function persistFleetApiLog(

  ctx: AmrFleetCallLogContext,

  operation: string,

  httpStatus: number,

  requestBody: unknown,

  responseBody: unknown

): Promise<void> {

  try {

    const id = uuidv4()

    const ts = formatLogRecordedAt()

    await ctx.db

      .prepare(

        `INSERT INTO amr_fleet_api_log (id, recorded_at, source, operation, http_status, mission_record_id, user_id, request_json, response_json)

         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

      )

      .run(

        id,

        ts,

        ctx.source,

        operation,

        httpStatus,

        ctx.missionRecordId ?? null,

        ctx.userId ?? null,

        truncateJsonBlob(requestBody),

        truncateJsonBlob(responseBody)

      )

  } catch (e) {

    console.warn('[amr-fleet] persist API log failed:', e)

  }

}



/** POST JSON to fleet `/api/amr/<operation>` with Authorization header. */

export async function forwardAmrFleetRequest(

  cfg: AmrFleetConfig,

  operation: string,

  body: unknown,

  log?: AmrFleetCallLogContext

): Promise<FleetForwardResult & { baseUrlError?: string }> {

  const finish = async (result: FleetForwardResult & { baseUrlError?: string }) => {

    if (log?.db) await persistFleetApiLog(log, operation, result.status, body, result.json)

    return result

  }



  const base = buildFleetBaseUrl(cfg)

  if (!base) {

    return finish({

      ok: false,

      status: 400,

      json: { error: 'Fleet server IP/port not configured' },

      baseUrlError: 'missing_host_or_port',

    })

  }

  const key = cfg.authKey?.trim()

  if (!key) {

    return finish({

      ok: false,

      status: 400,

      json: { error: 'Fleet auth key not configured' },

      baseUrlError: 'missing_auth',

    })

  }



  const url = `${base}/api/amr/${operation.replace(/^\/+/, '')}`

  const ctrl = new AbortController()

  const timer = setTimeout(() => ctrl.abort(), FLEET_TIMEOUT_MS)

  try {

    const res = await fetch(url, {

      method: 'POST',

      headers: {

        'Content-Type': 'application/json',

        Accept: 'application/json',

        Authorization: key,

      },

      body: JSON.stringify(body ?? {}),

      signal: ctrl.signal,

    })

    const text = await res.text()

    let json: unknown

    try {

      json = text ? JSON.parse(text) : null

    } catch {

      json = { raw: text }

    }

    return finish({ ok: res.ok, status: res.status, json, text })

  } catch (e) {

    const msg = e instanceof Error ? e.message : String(e)

    return finish({

      ok: false,

      status: 502,

      json: { error: 'Fleet request failed', detail: msg },

    })

  } finally {

    clearTimeout(timer)

  }

}

/**
 * KUKA-style fleet bodies often include `success: false` while HTTP may still be 200.
 * Treat omitted `success` as success (parity with {@link forwardAmrFleetRequest} + worker checks).
 */
export function fleetJsonIndicatesSuccess(json: unknown): boolean {
  if (json == null || typeof json !== 'object') return false
  return (json as { success?: boolean }).success !== false
}

export { buildFleetBaseUrl }

