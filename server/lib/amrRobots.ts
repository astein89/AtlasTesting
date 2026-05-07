import type { AsyncDbWrapper } from '../db/schema.js'
import type { AmrFleetConfig } from './amrConfig.js'
import { forwardAmrFleetRequest, type AmrFleetCallLogContext } from './amrFleet.js'

/**
 * Fleet `status` codes excluded from new mission assignment (mirrors `src/utils/amrRobotStatus.ts`).
 * 1 Departure (off-map) · 2 Offline · 6 Updating · 7 Abnormal.
 */
const ROBOT_STATUS_EXCLUDED_FROM_ASSIGNMENT = new Set([1, 2, 6, 7])

/**
 * Returns true when this fleet `status` represents a robot eligible to receive a new mission.
 * Non-numeric / unknown statuses pass through (`true`) — same loose stance as the client helper.
 */
export function isActiveRobotFleetStatus(status: unknown): boolean {
  const n = typeof status === 'number' ? status : Number(status)
  if (!Number.isFinite(n)) return true
  return !ROBOT_STATUS_EXCLUDED_FROM_ASSIGNMENT.has(n)
}

export type AmrRobotLockRow = {
  robotId: string
  locked: boolean
  lockedAt: string | null
  lockedBy: string | null
  notes: string | null
}

/** Set of `robot_id`s currently flagged `locked = 1` in `amr_robots`. */
export async function getLockedRobotIds(db: AsyncDbWrapper): Promise<Set<string>> {
  const rows = (await db
    .prepare('SELECT robot_id FROM amr_robots WHERE locked = 1')
    .all()) as Array<{ robot_id?: string }>
  const out = new Set<string>()
  for (const r of rows) {
    const id = typeof r.robot_id === 'string' ? r.robot_id.trim() : ''
    if (id) out.add(id)
  }
  return out
}

/** All persisted lock rows (for the client list endpoint). */
export async function listAmrRobotLockRows(db: AsyncDbWrapper): Promise<AmrRobotLockRow[]> {
  const rows = (await db
    .prepare(
      'SELECT robot_id, locked, locked_at, locked_by, notes FROM amr_robots ORDER BY robot_id'
    )
    .all()) as Array<{
    robot_id?: string
    locked?: number
    locked_at?: string | null
    locked_by?: string | null
    notes?: string | null
  }>
  return rows
    .map((r) => {
      const robotId = typeof r.robot_id === 'string' ? r.robot_id.trim() : ''
      if (!robotId) return null
      return {
        robotId,
        locked: Number(r.locked ?? 0) === 1,
        lockedAt: r.locked_at ?? null,
        lockedBy: r.locked_by ?? null,
        notes: r.notes ?? null,
      }
    })
    .filter((r): r is AmrRobotLockRow => r !== null)
}

/**
 * Live `robotQuery` minus locked ids. Returns sorted unique ids of robots whose fleet `status`
 * passes {@link isActiveRobotFleetStatus} and that are NOT in `amr_robots.locked = 1`.
 */
export async function resolveActiveUnlockedRobotIds(
  cfg: AmrFleetConfig,
  db: AsyncDbWrapper,
  log?: AmrFleetCallLogContext
): Promise<string[]> {
  const fr = await forwardAmrFleetRequest(cfg, 'robotQuery', { robotId: '', robotType: '' }, log)
  if (!fr.ok) return []
  const data = (fr.json as { data?: Array<Record<string, unknown>> } | null | undefined)?.data
  if (!Array.isArray(data)) return []
  const lockedIds = await getLockedRobotIds(db)
  const seen = new Set<string>()
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const rid = typeof row.robotId === 'string' ? row.robotId.trim() : ''
    if (!rid) continue
    if (!isActiveRobotFleetStatus(row.status)) continue
    if (lockedIds.has(rid)) continue
    seen.add(rid)
  }
  return [...seen].sort()
}

export type SubmitRobotIdsResolution =
  | { ok: true; robotIds: string[] }
  | {
      ok: false
      status: 409
      code: 'NO_UNLOCKED_ROBOTS'
      error: string
    }

/**
 * Resolves `submitMission.robotIds` for mission create.
 *
 * - If no robots are locked → behaviour matches legacy: client-supplied list (when present), else `cfg.robotIdsDefault`.
 * - If any robot is locked → either intersect the client pick with unlocked, or use the live active-unlocked list.
 * - When the resolved list ends up empty AND any robot is locked → returns NO_UNLOCKED_ROBOTS so the caller can 409.
 */
export async function resolveSubmitRobotIds(
  cfg: AmrFleetConfig,
  db: AsyncDbWrapper,
  clientPick: unknown,
  log?: AmrFleetCallLogContext
): Promise<SubmitRobotIdsResolution> {
  const lockedIds = await getLockedRobotIds(db)
  const pickArray = Array.isArray(clientPick)
    ? clientPick.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : null
  if (lockedIds.size === 0) {
    return { ok: true, robotIds: pickArray ?? cfg.robotIdsDefault }
  }
  let robotIds: string[]
  if (pickArray) {
    robotIds = pickArray.filter((id) => !lockedIds.has(id))
  } else {
    robotIds = await resolveActiveUnlockedRobotIds(cfg, db, log)
  }
  if (robotIds.length === 0) {
    return {
      ok: false,
      status: 409,
      code: 'NO_UNLOCKED_ROBOTS',
      error:
        'No unlocked robots available — every active robot is locked. Unlock at least one on the Robots page.',
    }
  }
  return { ok: true, robotIds }
}
