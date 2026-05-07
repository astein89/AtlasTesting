import { v4 as uuidv4 } from 'uuid'
import type { AsyncDbWrapper } from '../db/schema.js'

export type StandQueuePolicy = {
  bypassPalletCheck: boolean
  activeMissions: number
}

export async function getStandQueuePolicy(
  db: AsyncDbWrapper,
  standExternalRef: string
): Promise<StandQueuePolicy | null> {
  const ref = standExternalRef.trim()
  if (!ref) return null
  const row = (await db
    .prepare('SELECT bypass_pallet_check, active_missions FROM amr_stands WHERE external_ref = ?')
    .get(ref)) as
    | {
        bypass_pallet_check?: number | string | null
        active_missions?: number | string | null
      }
    | undefined
  if (!row) return null
  const activeRaw = Number(row.active_missions ?? 1)
  const activeMissions = Number.isFinite(activeRaw) && activeRaw >= 1 ? Math.floor(activeRaw) : 1
  return {
    bypassPalletCheck: Number(row.bypass_pallet_check ?? 0) === 1,
    activeMissions,
  }
}

export async function activeReservationCount(db: AsyncDbWrapper, standExternalRef: string): Promise<number> {
  const ref = standExternalRef.trim()
  if (!ref) return 0
  const row = (await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM amr_stand_reservations
       WHERE stand_external_ref = ? AND released_at IS NULL`
    )
    .get(ref)) as { c?: number | string } | undefined
  const n = Number(row?.c ?? 0)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

export function isStandAvailableForDrop(opts: {
  palletPresent: boolean
  policy: StandQueuePolicy
  activeReservations: number
}): boolean {
  const activeReservations = Number.isFinite(opts.activeReservations) ? opts.activeReservations : 0
  /** Never start another drop to this stand while any mission row still holds an unreleased reservation here. */
  if (activeReservations > 0) return false
  if (opts.policy.bypassPalletCheck) {
    return true
  }
  return !opts.palletPresent
}

export async function reserveStandForRecord(
  db: AsyncDbWrapper,
  standExternalRef: string,
  missionRecordId: string,
  opts?: { multistopSessionId?: string | null; multistopStepIndex?: number | null }
): Promise<void> {
  const ref = standExternalRef.trim()
  if (!ref || !missionRecordId.trim()) return
  const ts = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO amr_stand_reservations
         (id, stand_external_ref, mission_record_id, multistop_session_id, multistop_step_index, created_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      uuidv4(),
      ref,
      missionRecordId.trim(),
      opts?.multistopSessionId?.trim() || null,
      opts?.multistopStepIndex ?? null,
      ts
    )
}

export async function releaseReservationsForRecord(db: AsyncDbWrapper, missionRecordId: string): Promise<void> {
  const id = missionRecordId.trim()
  if (!id) return
  const ts = new Date().toISOString()
  await db
    .prepare(
      `UPDATE amr_stand_reservations
       SET released_at = ?
       WHERE mission_record_id = ? AND released_at IS NULL`
    )
    .run(ts, id)
}

