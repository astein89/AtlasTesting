/** Default window for dashboard / missions list (hide older app missions). */
export const APP_MISSION_DISPLAY_MAX_AGE_HOURS = 24

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

/**
 * App mission list UI — only show missions created within the last `maxAgeHours`.
 * Rows without a parseable `created_at` are excluded from display.
 */
export function filterAppMissionsRecent<T extends Record<string, unknown>>(
  records: T[],
  maxAgeHours: number = APP_MISSION_DISPLAY_MAX_AGE_HOURS
): T[] {
  const ms = maxAgeHours * MS_PER_HOUR
  const cutoff = Date.now() - ms
  return records.filter((r) => {
    const raw = r.created_at
    if (raw == null || raw === '') return false
    const t = new Date(raw as string | Date).getTime()
    if (!Number.isFinite(t)) return false
    return t >= cutoff
  })
}

function workerClosedMissionRecord<T extends Record<string, unknown>>(r: T): boolean {
  const v = r.worker_closed ?? (r as { workerClosed?: unknown }).workerClosed
  if (v === true) return true
  if (v === false || v === null || v === undefined) return false
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (t === '1' || t === 'true') return true
    if (t === '0' || t === 'false' || t === '') return false
    const n = Number(v.trim())
    return Number.isFinite(n) && n === 1
  }
  const n = Number(v)
  return Number.isFinite(n) && n === 1
}

function multistopSessionIdOnRecord<T extends Record<string, unknown>>(r: T): string {
  const raw = r.multistop_session_id ?? (r as { multistopSessionId?: unknown }).multistopSessionId
  if (typeof raw === 'string') return raw.trim()
  if (raw != null && typeof raw !== 'object') return String(raw).trim()
  return ''
}

function multistopSessionTerminalOnRecord<T extends Record<string, unknown>>(r: T): boolean {
  const raw =
    r.multistop_session_status ?? (r as { multistopSessionStatus?: unknown }).multistopSessionStatus
  const st = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return st === 'completed' || st === 'cancelled'
}

/**
 * Same as {@link filterAppMissionsRecent}, plus **still-live** rows whose `created_at` fell outside the window:
 * single-move missions while `worker_closed` is still open, and multistop segment rows whose session is not
 * `completed`/`cancelled`. Without this, long-running missions vanish from Active / grouping after 24h even though
 * the fleet job is still in progress.
 */
export function filterAppMissionsRecentOrLive<T extends Record<string, unknown>>(
  records: T[],
  maxAgeHours: number = APP_MISSION_DISPLAY_MAX_AGE_HOURS
): T[] {
  const ms = maxAgeHours * MS_PER_HOUR
  const cutoff = Date.now() - ms

  const isRecentByCreatedAt = (r: T) => {
    const raw = r.created_at
    if (raw == null || raw === '') return false
    const t = new Date(raw as string | Date).getTime()
    return Number.isFinite(t) && t >= cutoff
  }

  return records.filter((r) => {
    if (isRecentByCreatedAt(r)) return true
    const sid = multistopSessionIdOnRecord(r)
    if (sid) return !multistopSessionTerminalOnRecord(r)
    return !workerClosedMissionRecord(r)
  })
}

/** Fleet `last_status` values we treat as “finished” for the hide-after window (with `finalized`). */
const FLEET_COMPLETE_LIKE_STATUS = new Set([30, 31, 35])

function isFleetCompleteLikeForHide<T extends Record<string, unknown>>(r: T): boolean {
  if (Number(r.finalized) === 1) return true
  const n = typeof r.last_status === 'number' ? r.last_status : Number(r.last_status)
  return Number.isFinite(n) && FLEET_COMPLETE_LIKE_STATUS.has(n)
}

/**
 * After the app list is age-filtered, optionally drop rows that look fleet-complete
 * (`finalized === 1` or latest status Complete / Cancelled / Manual complete)
 * when their `updated_at` is older than `hideAfterMinutes`.
 * `null` or non-positive values skip this filter (all recent rows stay visible).
 */
export function filterHideStaleFleetCompleteMissions<T extends Record<string, unknown>>(
  records: T[],
  hideAfterMinutes: number | null
): T[] {
  if (hideAfterMinutes == null || !Number.isFinite(hideAfterMinutes) || hideAfterMinutes <= 0) return records
  const windowMs = hideAfterMinutes * MS_PER_MINUTE
  const now = Date.now()
  return records.filter((r) => {
    if (!isFleetCompleteLikeForHide(r)) return true
    const raw = r.updated_at
    if (raw == null || raw === '') return true
    const t = new Date(raw as string | Date).getTime()
    if (!Number.isFinite(t)) return true
    return now - t <= windowMs
  })
}

/** Missions page / settings — minute values for “hide fleet-complete after” (includes hour steps as minutes). */
export const HIDE_FLEET_COMPLETE_AFTER_MINUTE_OPTIONS = [
  10, 20, 30, 45, 60, 120, 360, 720, 1440, 2880, 4320,
] as const

export function labelHideFleetCompleteOption(mins: number): string {
  if (mins < 60) return `Hide after ${mins} min`
  if (mins % 60 === 0) return `Hide after ${mins / 60}h`
  return `Hide after ${mins} min`
}
