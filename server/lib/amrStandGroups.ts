import type { AsyncDbWrapper } from '../db/schema.js'
import {
  activeReservationCount,
  getStandQueuePolicy,
  isStandAvailableForDrop,
} from './amrStandAvailability.js'
import { fetchStandPresenceFromHyperion } from './amrStandPresence.js'
import type { AmrHyperionConfig } from './hyperionConfig.js'
import { hyperionConfigured } from './hyperionConfig.js'

/** Synthetic position prefix for queued rack-move payloads until a member stand is resolved (never sent to fleet). */
export const AMR_STAND_GROUP_SENTINEL_PREFIX = '__group:'

export function standGroupSentinelPosition(groupId: string): string {
  const id = groupId.trim()
  return id ? `${AMR_STAND_GROUP_SENTINEL_PREFIX}${id}` : ''
}

export function parseStandGroupSentinelPosition(position: string): string | null {
  const t = position.trim()
  if (!t.startsWith(AMR_STAND_GROUP_SENTINEL_PREFIX)) return null
  const id = t.slice(AMR_STAND_GROUP_SENTINEL_PREFIX.length).trim()
  return id || null
}

export type StandGroupMemberRow = {
  stand_id: string
  external_ref: string
  bypass_pallet_check: number
  active_missions: number
  enabled: number
  block_pickup: number
  block_dropoff: number
}

export async function getStandGroupMembers(
  db: AsyncDbWrapper,
  groupId: string
): Promise<StandGroupMemberRow[]> {
  const gid = groupId.trim()
  if (!gid) return []
  const rows = (await db
    .prepare(
      `SELECT s.id AS stand_id, s.external_ref, s.bypass_pallet_check, s.active_missions, s.enabled,
              s.block_pickup, s.block_dropoff
       FROM amr_stand_group_members m
       JOIN amr_stands s ON s.id = m.stand_id
       WHERE m.group_id = ?
       ORDER BY m.position ASC, s.external_ref ASC`
    )
    .all(gid)) as StandGroupMemberRow[]
  return rows.filter((r) => Number(r.enabled ?? 1) === 1)
}

export type ResolveGroupDestinationResult =
  | { ok: true; externalRef: string }
  | { ok: false; reason: 'empty_group' | 'all_occupied' | 'hyperion_unavailable'; message?: string }

/**
 * Pick first member stand that passes availability (presence + reservations + bypass cap), in member order.
 */
export async function resolveGroupDestination(params: {
  db: AsyncDbWrapper
  hcfg: AmrHyperionConfig | null
  groupId: string
  userId?: string | null
  source: string
  /** Skip Hyperion presence (e.g. force-continue); uses reservation / bypass rules only. */
  ignorePresence?: boolean
}): Promise<ResolveGroupDestinationResult> {
  const members = await getStandGroupMembers(params.db, params.groupId)
  if (members.length === 0) return { ok: false, reason: 'empty_group' }

  const refsNonBypass: string[] = []
  for (const m of members) {
    const policy = await getStandQueuePolicy(params.db, m.external_ref)
    const bypass =
      Number(m.bypass_pallet_check ?? 0) === 1 || policy?.bypassPalletCheck === true
    if (!bypass) refsNonBypass.push(m.external_ref.trim())
  }

  const presence: Record<string, boolean> = {}
  if (!params.ignorePresence && refsNonBypass.length > 0) {
    const hc = params.hcfg
    if (!hc || !hyperionConfigured(hc)) {
      return {
        ok: false,
        reason: 'hyperion_unavailable',
        message: 'Hyperion API is not configured. Cannot verify stand availability for group destinations.',
      }
    }
    const pr = await fetchStandPresenceFromHyperion(hc, refsNonBypass, {
      db: params.db,
      source: params.source,
      userId: params.userId ?? undefined,
    })
    if (!pr.ok) {
      const st = typeof pr.status === 'number' && pr.status >= 400 && pr.status < 600 ? pr.status : 502
      return {
        ok: false,
        reason: 'hyperion_unavailable',
        message: pr.message || `Hyperion presence failed (${st}).`,
      }
    }
    Object.assign(presence, pr.presence)
  }

  for (const m of members) {
    const ref = m.external_ref.trim()
    const policy = await getStandQueuePolicy(params.db, ref)
    const bypass =
      Number(m.bypass_pallet_check ?? 0) === 1 || policy?.bypassPalletCheck === true
    let palletPresent = false
    if (!params.ignorePresence && !bypass) {
      palletPresent = presence[ref] === true
    }
    const activeReservations = await activeReservationCount(params.db, ref)
    const available = isStandAvailableForDrop({
      palletPresent,
      policy: {
        bypassPalletCheck: bypass,
        activeMissions: policy?.activeMissions ?? 1,
      },
      activeReservations,
    })
    if (available) return { ok: true, externalRef: ref }
  }

  return { ok: false, reason: 'all_occupied' }
}

/** Next synthetic zone key for zoneCategories picker ordering (`__group:<uuid>`). */
export function standGroupZoneKey(groupId: string): string {
  const id = groupId.trim()
  return id ? `${AMR_STAND_GROUP_SENTINEL_PREFIX}${id}` : ''
}
