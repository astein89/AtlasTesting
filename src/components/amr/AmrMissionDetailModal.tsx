import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  ackPresenceWarning,
  continueAmrMultistopSession,
  forceReleaseMission,
  getAmrMultistopSession,
  getAmrSettings,
  getAmrStandGroups,
  getAmrStands,
  patchAmrMultistopSession,
  postStandPresence,
  terminateStuckAmrMultistopSession,
  type AmrStandPickerMode,
  type ZoneCategory,
} from '@/api/amr'
import { getApiErrorMessage, parseMultistopContinueStandOccupied } from '@/api/client'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import {
  AmrStandPickerModal,
  LocationPinIcon,
  type AmrStandPickerRow,
} from '@/components/amr/AmrStandPickerModal'
import { AmrStandOccupiedContinueModal } from '@/components/amr/AmrStandOccupiedContinueModal'
import { AmrStandPresenceRow } from '@/components/amr/AmrStandPresenceRow'
import { PalletPresenceGlyph, palletPresenceKindFromState } from '@/components/amr/PalletPresenceGlyph'
import { amrPath } from '@/lib/appPaths'
import { friendlyMultistopSessionStatus } from '@/utils/amrMultistopDisplay'

const emptyStandPresenceBypass = new Set<string>()
import {
  multistopContinueOccupiedDestinationRef,
  multistopContinueReleaseDisabledUntilStandShowsEmpty,
  multistopStandOccupiedContinueMessage,
  parseMultistopReleasePlanDestinations,
  refBypassesPalletCheck,
  standRefsBypassingPalletCheck,
  type MultistopReleasePlanDest,
} from '@/utils/amrPalletPresenceSanity'
import { formatRemainingMmSs, remainingMsUntilIso } from '@/utils/amrContinueCountdown'
import {
  MISSION_QUEUED_CALLOUT_CLASS,
  MISSION_QUEUED_ROUTE_LEG_CARD_CLASS,
  missionOverviewOrDetailQueuedHue,
} from '@/utils/amrMissionJobStatus'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAuthStore } from '@/store/authStore'

export type AmrMissionRecordRow = Record<string, unknown>

/**
 * Prefer live `GET …/multistop/:id` session row; fall back to mission-list JOIN (`multistop_session_status`) so route
 * actions stay enabled while session loads or if the session object omits `status`.
 */
function multistopSessionStatusFromSources(
  session: Record<string, unknown> | undefined | null,
  record: AmrMissionRecordRow | null
): string | null {
  if (session) {
    const raw = session.status ?? session.Status
    if (raw != null && String(raw).trim()) return String(raw).trim()
  }
  if (!record) return null
  const r =
    record.multistop_session_status ??
    (record as { multistopSessionStatus?: unknown }).multistopSessionStatus
  if (r != null && String(r).trim()) return String(r).trim()
  return null
}

function parsePayload(record: AmrMissionRecordRow): Record<string, unknown> | null {
  const raw = record.mission_payload_json
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function missionSteps(payload: Record<string, unknown> | null): Array<{ sequence: number; position: string }> {
  if (!payload) return []
  const submit = payload.submit as { missionData?: unknown[] } | undefined
  const md = submit?.missionData
  if (!Array.isArray(md)) return []
  const out: Array<{ sequence: number; position: string }> = []
  for (let i = 0; i < md.length; i++) {
    const step = md[i] as { sequence?: number; position?: unknown }
    const seq = typeof step.sequence === 'number' ? step.sequence : i + 1
    const position = step.position != null ? String(step.position) : ''
    if (position) out.push({ sequence: seq, position })
  }
  out.sort((a, b) => a.sequence - b.sequence)
  return out
}

function containerInSummary(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const ci = payload.containerIn as { position?: unknown } | undefined
  const p = ci?.position
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

/** Robot IDs sent with submitMission (fleet assignment pool). */
function submitRobotIdsFromPayload(payload: Record<string, unknown> | null): string[] {
  if (!payload) return []
  const submit = payload.submit as { robotIds?: unknown } | undefined
  const ids = submit?.robotIds
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const x of ids) {
    if (typeof x === 'string' && x.trim()) out.push(x.trim())
  }
  return out
}

/** Robot chosen for this segment’s submitMission (`unlockRobotId`). Present while a leg is active after Continue clears session `locked_robot_id`. */
function unlockRobotIdFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const submit = payload.submit as { unlockRobotId?: unknown } | undefined
  const u = submit?.unlockRobotId
  return typeof u === 'string' && u.trim() ? u.trim() : null
}

function ynFlag(v: unknown): string {
  return Number(v) === 1 ? 'Yes' : 'No'
}

function trackingFriendly(workerClosed: unknown): string {
  return Number(workerClosed) === 1 ? 'Stopped' : 'Active'
}

function msStepIndex(r: Record<string, unknown>): number {
  const raw = r.multistop_step_index
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

type MultistopPlanDest = {
  position: string
  continueMode?: 'manual' | 'auto'
  autoContinueSeconds?: number
  /** Intermediate stops: fleet drop vs pickup at this NODE_POINT; final stop is always drop. */
  putDown?: boolean
  /** Lazy-resolve pool (stop 2+); `position` may be empty until dispatch. */
  groupId?: string
}

type DraftDest = MultistopPlanDest & { id: string }

/** Last destination is always drop; others use explicit `putDown` (default pickup-only). */
function normalizeDraftPutDownRows(rows: DraftDest[]): DraftDest[] {
  const n = rows.length
  if (n === 0) return rows
  return rows.map((r, i) => ({
    ...r,
    putDown: i === n - 1 ? true : r.putDown === true,
  }))
}

/** Payload rows stored / PATCHed — fleet missionData stays AUTO / zero wait; app fields for release timing. */
function draftToPlan(rows: DraftDest[]): Record<string, unknown>[] {
  const normalized = normalizeDraftPutDownRows(rows)
  return normalized.map((row) => {
    const position = row.position.trim()
    const gid = row.groupId?.trim() ?? ''
    const mode = row.continueMode === 'auto' ? 'auto' : 'manual'
    const base: Record<string, unknown> = {
      passStrategy: 'AUTO',
      waitingMillis: 0,
      continueMode: mode,
      putDown: row.putDown === true,
    }
    if (gid) {
      base.groupId = gid
      base.position = position
    } else {
      base.position = position
    }
    if (mode === 'auto') {
      const sec = Math.max(0, Math.min(Math.floor(row.autoContinueSeconds ?? 0), 86400))
      base.autoContinueSeconds = sec
    }
    return base
  })
}

function parsePlanDestinations(planJson: unknown): MultistopPlanDest[] | null {
  if (typeof planJson !== 'string' || !planJson.trim()) return null
  try {
    const o = JSON.parse(planJson) as { destinations?: unknown }
    if (!Array.isArray(o.destinations)) return null
    const out: MultistopPlanDest[] = []
    for (const x of o.destinations) {
      if (!x || typeof x !== 'object') return null
      const row = x as Record<string, unknown>
      const position = typeof row.position === 'string' ? row.position.trim() : ''
      const groupId = typeof row.groupId === 'string' ? row.groupId.trim() : ''
      if (!position && !groupId) return null
      const cm = row.continueMode === 'auto' ? 'auto' : 'manual'
      const n =
        typeof row.autoContinueSeconds === 'number'
          ? row.autoContinueSeconds
          : Number(row.autoContinueSeconds)
      const entry: MultistopPlanDest = { position, continueMode: cm }
      if (groupId) entry.groupId = groupId
      if (typeof row.putDown === 'boolean') entry.putDown = row.putDown
      if (cm === 'auto' && Number.isFinite(n) && n >= 0) {
        entry.autoContinueSeconds = Math.min(Math.max(0, Math.floor(n)), 86400)
      }
      out.push(entry)
    }
    return out.length ? out : null
  } catch {
    return null
  }
}

function planToDraft(plan: MultistopPlanDest[]): DraftDest[] {
  return plan.map((d) => ({ ...d, id: uuidv4() }))
}

/** Fleet fork at segment end (arrival at To). */
function arriveForkAction(
  row: MultistopPlanDest,
  segmentIndexInPlan: number,
  totalDestinations: number
): 'lower' | 'lift' {
  if (totalDestinations < 1) return 'lift'
  const lower =
    segmentIndexInPlan >= totalDestinations - 1 ? true : row.putDown === true
  return lower ? 'lower' : 'lift'
}

function formatReleaseAfterStopReadOnly(
  row: MultistopPlanDest,
  segmentIndexInPlan: number,
  totalDestinations: number
): string {
  if (totalDestinations < 1) return 'After arrival: Manual release'
  if (segmentIndexInPlan >= totalDestinations - 1) return 'After arrival: Manual (final stop)'
  const mode = row.continueMode === 'auto' ? 'auto' : 'manual'
  if (mode === 'auto') {
    const s = row.autoContinueSeconds
    if (typeof s === 'number' && Number.isFinite(s) && s === 0) {
      return 'After arrival: Auto-release immediately'
    }
    if (typeof s === 'number' && Number.isFinite(s) && s >= 1) {
      return `After arrival: Auto-release after ${Math.min(Math.floor(s), 86400)}s`
    }
  }
  return 'After arrival: Manual release'
}

function parsePickupContinueFromPlanJson(planJson: unknown): {
  continueMode: 'manual' | 'auto'
  autoContinueSeconds?: number
} | null {
  if (typeof planJson !== 'string' || !planJson.trim()) return null
  try {
    const o = JSON.parse(planJson) as { pickupContinue?: unknown }
    const pc = o.pickupContinue
    if (!pc || typeof pc !== 'object') return null
    const pcr = pc as Record<string, unknown>
    const pcm = pcr.continueMode === 'auto' ? 'auto' : 'manual'
    const pn =
      typeof pcr.autoContinueSeconds === 'number'
        ? pcr.autoContinueSeconds
        : Number(pcr.autoContinueSeconds)
    if (pcm === 'auto' && Number.isFinite(pn) && pn >= 0) {
      return { continueMode: 'auto', autoContinueSeconds: Math.min(Math.max(0, Math.floor(pn)), 86400) }
    }
    return { continueMode: 'manual' }
  } catch {
    return null
  }
}

function formatPickupReleaseLine(pc: {
  continueMode: 'manual' | 'auto'
  autoContinueSeconds?: number
}): string {
  if (pc.continueMode === 'auto' && typeof pc.autoContinueSeconds === 'number') {
    if (pc.autoContinueSeconds === 0) return 'Before first leg: Auto-release immediately'
    if (pc.autoContinueSeconds >= 1) return `Before first leg: Auto-release after ${pc.autoContinueSeconds}s`
  }
  return 'Before first leg: Manual release'
}

function normalizeExternalRefFromStands(stands: AmrStandPickerRow[], raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const exact = stands.find((s) => s.external_ref === t)
  if (exact) return exact.external_ref
  const ci = stands.find((s) => s.external_ref.trim().toLowerCase() === t.toLowerCase())
  return ci?.external_ref ?? t
}

function filterStandsForSuggest(stands: AmrStandPickerRow[], query: string): AmrStandPickerRow[] {
  const sorted = [...stands].sort((a, b) => a.external_ref.localeCompare(b.external_ref))
  const t = query.trim().toLowerCase()
  if (!t) return sorted.slice(0, 80)
  return sorted.filter((s) => s.external_ref.toLowerCase().includes(t)).slice(0, 80)
}

function legRestrictionStatus(
  stands: AmrStandPickerRow[],
  position: string,
  putDownOn: boolean
): { violated: boolean; message: string } {
  const t = position.trim()
  if (!t) return { violated: false, message: '' }
  const m =
    stands.find((s) => s.external_ref === t) ??
    stands.find((s) => s.external_ref.trim().toLowerCase() === t.toLowerCase())
  if (!m) return { violated: false, message: '' }
  if (!putDownOn && Number(m.block_pickup ?? 0) > 0) {
    return { violated: true, message: 'This location does not allow pallet pickup (no lift).' }
  }
  if (putDownOn && Number(m.block_dropoff ?? 0) > 0) {
    return { violated: true, message: 'This location does not allow pallet dropoff (no lower).' }
  }
  return { violated: false, message: '' }
}

function planDestEndpointLabel(
  row: MultistopPlanDest | undefined,
  groupNames?: Record<string, string>
): string {
  if (!row) return '—'
  const pos = row.position?.trim() ?? ''
  if (pos) return pos
  const gid = row.groupId?.trim()
  if (gid) {
    const name = groupNames?.[gid]
    return name ? `[group] ${name}` : `[group] ${gid}`
  }
  return '—'
}

/** Start/end nodes for plan segment index `si` (0-based). */
function segmentLegEndpoints(
  si: number,
  plan: MultistopPlanDest[] | null | undefined,
  pickup: string | null,
  groupNames?: Record<string, string>
): { start: string; end: string } {
  const p = plan ?? []
  const end = planDestEndpointLabel(p[si], groupNames)
  const start =
    si === 0 ? pickup?.trim() || '—' : planDestEndpointLabel(p[si - 1], groupNames)
  return { start, end }
}

function isHyperionPollableStandRef(ref: string): boolean {
  const t = ref.trim()
  if (!t || t === '—') return false
  return !t.startsWith('[group]')
}

function validateMultistopPlan(
  plan: Array<{
    position: string
    groupId?: string
    continueMode?: 'manual' | 'auto'
    autoContinueSeconds?: number
  }>
): string | null {
  for (let i = 0; i < plan.length; i++) {
    const row = plan[i]
    if (!row.position.trim() && !row.groupId?.trim()) {
      return `Destination ${i + 1} needs an External Ref or stand group.`
    }
  }
  for (let i = 0; i < plan.length - 1; i++) {
    const r = plan[i]
    if (r.continueMode === 'auto') {
      const s = r.autoContinueSeconds ?? 0
      if (!Number.isFinite(s) || s < 0 || s > 86400) {
        return `Destination ${i + 1}: Auto Release needs 0–86400 seconds.`
      }
    }
  }
  return null
}

type PickupContinueDraft = {
  continueMode: 'manual' | 'auto'
  autoContinueSeconds?: number
}

function defaultPickupContinueDraft(): PickupContinueDraft {
  return { continueMode: 'manual' }
}

function validatePickupContinueDraft(pc: PickupContinueDraft | null): string | null {
  if (!pc || pc.continueMode !== 'auto') return null
  const s = pc.autoContinueSeconds ?? 0
  if (!Number.isFinite(s) || s < 0 || s > 86400) {
    return 'Before first leg: Auto Release needs 0–86400 seconds.'
  }
  return null
}

function planEditSnapshot(
  rows: DraftDest[] | null,
  pickup: PickupContinueDraft | null,
  segmentFirstNodePutDown: boolean[]
): string {
  if (!rows) return ''
  return JSON.stringify({
    d: draftToPlan(rows),
    p: pickup ?? { continueMode: 'manual' as const },
    s: segmentFirstNodePutDown,
  })
}

type RouteStandPresenceSlice = {
  map: Record<string, boolean | null>
  loading: boolean
  error: boolean
  unconfigured: boolean
  bypassRefs: Set<string>
}

/** Hyperion reports a pallet at the leg destination (To) — matches stand-occupied modal emphasis. */
function destinationStandReadsOccupied(legEnd: string, standPresence?: RouteStandPresenceSlice): boolean {
  if (!standPresence) return false
  const ref = legEnd.trim()
  if (!ref || ref === '—') return false
  if (standPresence.unconfigured || standPresence.error) return false
  if (refBypassesPalletCheck(ref, standPresence.bypassRefs)) return false
  return standPresence.map[ref] === true
}

function SortableTailDestCard({
  row,
  tailSlot,
  reorderable,
  stopNum,
  totalStops,
  legStart,
  legEnd,
  standPresence,
  legToolbar,
  sortableDisabled,
  segmentIndexInPlan,
  totalDestinations,
  warnDestinationOccupied,
  highlightQueued,
  departPutDown,
}: {
  row: DraftDest
  /** 1 = next fleet leg (first in tail); drives highlight vs later stops. */
  tailSlot: number
  /** When false, drag handle is hidden (nothing to reorder). */
  reorderable?: boolean
  stopNum: number
  totalStops: number
  legStart: string
  legEnd: string
  /** When set, show stacked From/To + pallet presence like Mission Overview. */
  standPresence?: RouteStandPresenceSlice
  /** Edit / Remove — editing opens the route stop modal. */
  legToolbar?: {
    editLabel: string
    onEdit: () => void
    onRemove: () => void
    canRemove: boolean
  } | null
  /** When true, card stays in the sortable list but cannot be dragged (view-only route). */
  sortableDisabled?: boolean
  /** 0-based index in full destination list; release timing applies before next leg except final stop. */
  segmentIndexInPlan?: number
  totalDestinations?: number
  /**
   * Red “stand occupied / unable to dispatch” treatment applies only when DC is waiting for Continue
   * (`awaiting_continue`). Hide while a segment is **active** so in-flight work does not look like a release block.
   */
  warnDestinationOccupied?: boolean
  /** This leg is waiting on stand queue / deferred dispatch (violet card — not the whole modal). */
  highlightQueued?: boolean
  /** Fleet putDown at first NODE_POINT of this segment (Depart). */
  departPutDown: boolean
}) {
  const fromFork: 'lower' | 'lift' = departPutDown ? 'lower' : 'lift'
  const toFork =
    typeof segmentIndexInPlan === 'number' && typeof totalDestinations === 'number'
      ? arriveForkAction(row, segmentIndexInPlan, totalDestinations)
      : 'lift'
  const isNext = tailSlot === 1
  const destOccupied =
    warnDestinationOccupied !== false &&
    destinationStandReadsOccupied(legEnd, standPresence)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: sortableDisabled === true,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const showGrip = reorderable !== false
  const stopHeading = (
    <div className="mb-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold tabular-nums text-foreground">
            <span>
              Stop {stopNum} of {totalStops}
            </span>
            {highlightQueued === true ? (
              <span className="rounded-full bg-violet-400/25 px-2 py-0.5 text-[10px] font-medium text-violet-950 dark:bg-violet-500/25 dark:text-violet-100">
                Queued
              </span>
            ) : null}
          </p>
          {standPresence ? (
            <div className="mt-1.5 space-y-1">
              <AmrStandPresenceRow
                label="From"
                standRef={legStart}
                presenceMap={standPresence.map}
                loading={standPresence.loading}
                error={standPresence.error}
                unconfigured={standPresence.unconfigured}
                bypassRefs={standPresence.bypassRefs}
                forkAction={fromFork}
              />
              <AmrStandPresenceRow
                label="To"
                standRef={legEnd}
                presenceMap={standPresence.map}
                loading={standPresence.loading}
                error={standPresence.error}
                unconfigured={standPresence.unconfigured}
                bypassRefs={standPresence.bypassRefs}
                forkAction={toFork}
              />
            </div>
          ) : (
            <div className="mt-1.5 space-y-1 text-sm leading-normal text-foreground/85">
              <p className="break-all font-mono">
                <span className="text-foreground/50">From </span>
                {legStart}
                <span className="text-foreground/35"> &gt; </span>
                <span className="font-sans text-[10px] font-semibold uppercase text-foreground/75">
                  {fromFork === 'lower' ? 'LOWER' : 'LIFT'}
                </span>
              </p>
              <p className="break-all font-mono">
                <span className="text-foreground/50">To </span>
                {legEnd}
                <span className="text-foreground/35"> &gt; </span>
                <span className="font-sans text-[10px] font-semibold uppercase text-foreground/75">
                  {toFork === 'lower' ? 'LOWER' : 'LIFT'}
                </span>
              </p>
            </div>
          )}
        </div>
        {legToolbar ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
              onClick={legToolbar.onEdit}
            >
              {legToolbar.editLabel}
            </button>
            <button
              type="button"
              disabled={!legToolbar.canRemove}
              title={
                legToolbar.canRemove ? 'Remove this upcoming destination' : 'Keep at least one remaining stop'
              }
              className="rounded-md border border-red-500/35 bg-background px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
              onClick={legToolbar.onRemove}
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
  return (
    <div
      ref={setNodeRef}
      style={style}
      aria-invalid={destOccupied ? true : undefined}
      className={`rounded-lg border p-3 ${
        showGrip
          ? 'grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 items-start'
          : 'flex flex-col gap-2'
      } ${
        destOccupied
          ? 'border-red-500/45 bg-red-500/10 ring-1 ring-red-500/25 dark:border-red-500/40 dark:bg-red-950/35'
          : highlightQueued === true
            ? MISSION_QUEUED_ROUTE_LEG_CARD_CLASS
            : isNext
              ? 'border-primary/45 bg-primary/8 ring-1 ring-primary/20'
              : 'border-border/80 bg-muted/15'
      } ${isDragging ? 'z-[5] opacity-95 shadow-md' : ''}`}
    >
      {destOccupied ? (
        <p
          role="alert"
          className={`text-base font-semibold leading-snug text-red-600 dark:text-red-400 ${
            showGrip ? 'col-span-2' : ''
          }`}
        >
          {multistopStandOccupiedContinueMessage(legEnd)}
        </p>
      ) : null}
      {showGrip ? (
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 touch-none items-center justify-center self-start rounded-lg border border-border bg-muted/40 text-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder remaining stops"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <circle cx="9" cy="8" r="1.5" />
            <circle cx="15" cy="8" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="16" r="1.5" />
            <circle cx="15" cy="16" r="1.5" />
          </svg>
        </button>
      ) : null}
      <div className="min-w-0 flex flex-col gap-2">
        {stopHeading}
        {typeof segmentIndexInPlan === 'number' && typeof totalDestinations === 'number' ? (
          <p className="mt-2 text-xs text-foreground/65">
            {formatReleaseAfterStopReadOnly(row, segmentIndexInPlan, totalDestinations)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2.5 last:border-0 sm:grid sm:grid-cols-[minmax(8rem,11rem)_1fr] sm:items-start sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-foreground/55">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  )
}

export interface AmrMissionDetailModalProps {
  record: AmrMissionRecordRow | null
  onClose: () => void
  /** Refresh parent mission list after Add Stop continue or plan patch */
  onSessionUpdated?: () => void
}

export function AmrMissionDetailModal({ record, onClose, onSessionUpdated }: AmrMissionDetailModalProps) {
  const canManage = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const canForceRelease = useAuthStore((s) => s.hasPermission('amr.missions.force_release'))
  const [msRefresh, setMsRefresh] = useState(0)
  const [msData, setMsData] = useState<{
    session: Record<string, unknown>
    records: Record<string, unknown>[]
  } | null>(null)
  const [msLoading, setMsLoading] = useState(false)
  const [msErr, setMsErr] = useState<string | null>(null)
  /** Set when Continue throws from the API — not when we block early for stand occupied (client pre-check). */
  const [continueApiFailed, setContinueApiFailed] = useState(false)
  const [continueBlockedStandRef, setContinueBlockedStandRef] = useState<string | null>(null)
  const [standOccupiedModalDismissed, setStandOccupiedModalDismissed] = useState(false)
  const [blockedDestPresence, setBlockedDestPresence] = useState<boolean | null>(null)
  const [blockedDestPresenceLoading, setBlockedDestPresenceLoading] = useState(false)
  const [blockedDestPresenceError, setBlockedDestPresenceError] = useState(false)
  const [blockedDestPresenceUnconfig, setBlockedDestPresenceUnconfig] = useState(false)
  const [forceReleaseConfirmOpen, setForceReleaseConfirmOpen] = useState(false)
  const [queuedMissionForceOpen, setQueuedMissionForceOpen] = useState(false)
  const [queuedMissionForceBusy, setQueuedMissionForceBusy] = useState(false)
  const [ackPresenceBusy, setAckPresenceBusy] = useState(false)
  const [terminateStuckConfirmOpen, setTerminateStuckConfirmOpen] = useState(false)
  const [terminateStuckBusy, setTerminateStuckBusy] = useState(false)
  const [continueBusy, setContinueBusy] = useState(false)
  const [patchBusy, setPatchBusy] = useState(false)
  const [draftDestinations, setDraftDestinations] = useState<DraftDest[] | null>(null)
  /** Editable when session is waiting at segment 0 (before first destination leg); PATCH `pickupContinue`. */
  const [draftPickupContinue, setDraftPickupContinue] = useState<PickupContinueDraft | null>(null)
  /** Parallel to segments / destination count: fleet putDown on each segment's first NODE_POINT. */
  const [draftSegFirstPutDown, setDraftSegFirstPutDown] = useState<boolean[]>([])
  const [savedPlanSnapshot, setSavedPlanSnapshot] = useState('')
  const [planEditErr, setPlanEditErr] = useState<string | null>(null)

  /** Whole-route stand refs for Hyperion presence — matches Mission Overview (`pollMsContainers` auto-refresh). */
  const [routeStandPresenceMap, setRouteStandPresenceMap] = useState<Record<string, boolean | null>>({})
  const [routeStandPresenceLoading, setRouteStandPresenceLoading] = useState(false)
  const [routeStandPresenceError, setRouteStandPresenceError] = useState(false)
  const [routeStandPresenceUnconfig, setRouteStandPresenceUnconfig] = useState(false)
  const [pollMsContainers, setPollMsContainers] = useState(5000)
  const [standPresenceSanityOn, setStandPresenceSanityOn] = useState(true)

  const [standRows, setStandRows] = useState<AmrStandPickerRow[]>([])
  const palletPresenceBypassRefs = useMemo(() => standRefsBypassingPalletCheck(standRows), [standRows])
  const [zoneCategories, setZoneCategories] = useState<ZoneCategory[]>([])
  const [overrideSpecialLocations, setOverrideSpecialLocations] = useState(false)
  const canOverrideSpecial = useAuthStore((s) => s.hasPermission('amr.stands.override-special'))
  type RouteStopModalState = null | { mode: 'add' } | { mode: 'edit'; rowId: string }
  const [routeStopModal, setRouteStopModal] = useState<RouteStopModalState>(null)
  const [addStopPosition, setAddStopPosition] = useState('')
  /** Defaults for the new row; take effect once this stop has a following destination (see helper copy). */
  const [addStopContinueMode, setAddStopContinueMode] = useState<'manual' | 'auto'>('manual')
  const [addStopAutoSeconds, setAddStopAutoSeconds] = useState(0)
  /** Intermediate-stop edit: fleet drop vs pickup at this NODE_POINT (final stop is always drop). */
  const [routeStopPutDown, setRouteStopPutDown] = useState(true)
  const [addStopErr, setAddStopErr] = useState<string | null>(null)
  const [addStopSuggestOpen, setAddStopSuggestOpen] = useState(false)
  const [addStopPickerOpen, setAddStopPickerOpen] = useState(false)
  /** Stop 2+ stand-group pool (lazy-resolve); cleared when a concrete stand ref is chosen. */
  const [addStopGroupId, setAddStopGroupId] = useState<string | null>(null)
  const [standGroupNameById, setStandGroupNameById] = useState<Record<string, string>>({})
  const addStopSuggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Avoid msLoading flicker when parent polling bumps `record.updated_at` but session id is unchanged. */
  const prevFetchedMultistopSessionIdRef = useRef<string | null>(null)

  const cancelAddStopSuggestClose = useCallback(() => {
    if (addStopSuggestTimerRef.current) {
      clearTimeout(addStopSuggestTimerRef.current)
      addStopSuggestTimerRef.current = null
    }
  }, [])

  const scheduleAddStopSuggestClose = useCallback(() => {
    cancelAddStopSuggestClose()
    addStopSuggestTimerRef.current = setTimeout(() => setAddStopSuggestOpen(false), 180)
  }, [cancelAddStopSuggestClose])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const sessionId = record ? String(record.multistop_session_id ?? '').trim() : ''

  useEffect(() => {
    if (!record) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (addStopPickerOpen) {
        e.preventDefault()
        setAddStopPickerOpen(false)
        return
      }
      if (routeStopModal) {
        e.preventDefault()
        cancelAddStopSuggestClose()
        setAddStopSuggestOpen(false)
        setAddStopGroupId(null)
        setRouteStopModal(null)
        setAddStopErr(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    record,
    onClose,
    addStopPickerOpen,
    routeStopModal,
    cancelAddStopSuggestClose,
  ])

  useEffect(() => {
    void getAmrStands().then((rows) =>
      setStandRows(
        rows.map((r) => ({
          id: String(r.id),
          external_ref: String(r.external_ref ?? ''),
          zone: r.zone != null ? String(r.zone) : '',
          location_label: String(r.location_label ?? ''),
          orientation: String(r.orientation ?? '0'),
          block_pickup: Number(r.block_pickup ?? 0),
          block_dropoff: Number(r.block_dropoff ?? 0),
          bypass_pallet_check: Number(r.bypass_pallet_check ?? 0),
        }))
      )
    )
    void getAmrSettings().then((s) => {
      setZoneCategories(Array.isArray(s.zoneCategories) ? s.zoneCategories : [])
      setPollMsContainers(Math.max(3000, s.pollMsContainers))
      setStandPresenceSanityOn(s.missionCreateStandPresenceSanityCheck !== false)
    })
    void getAmrStandGroups().then((groups) => {
      const m: Record<string, string> = {}
      for (const g of groups) {
        const id = String(g.id ?? '').trim()
        if (!id) continue
        const nm = String(g.name ?? '').trim()
        m[id] = nm || id
      }
      setStandGroupNameById(m)
    })
  }, [])

  useEffect(() => {
    cancelAddStopSuggestClose()
    setAddStopSuggestOpen(false)
    setAddStopPickerOpen(false)
    setAddStopGroupId(null)
    setRouteStopModal(null)
    setAddStopErr(null)
  }, [sessionId, cancelAddStopSuggestClose])

  useEffect(() => {
    if (!sessionId) {
      prevFetchedMultistopSessionIdRef.current = null
      setMsData(null)
      setMsErr(null)
      setContinueApiFailed(false)
      setContinueBlockedStandRef(null)
      setDraftDestinations(null)
      setDraftPickupContinue(null)
      setDraftSegFirstPutDown([])
      setSavedPlanSnapshot('')
      return
    }
    const sessionIdChanged = prevFetchedMultistopSessionIdRef.current !== sessionId
    prevFetchedMultistopSessionIdRef.current = sessionId
    if (sessionIdChanged) {
      setMsLoading(true)
    }
    setMsErr(null)
    setContinueApiFailed(false)
    setContinueBlockedStandRef(null)
    let cancelled = false
    void getAmrMultistopSession(sessionId)
      .then((d) => {
        if (cancelled) return
        setMsData(d)
        const parsed = parsePlanDestinations(d.session?.plan_json)
        if (parsed) {
          const draft = normalizeDraftPutDownRows(planToDraft(parsed))
          const pc = parsePickupContinueFromPlanJson(d.session?.plan_json) ?? defaultPickupContinueDraft()
          let segInit: boolean[] = []
          try {
            const rawPlan = JSON.parse(String(d.session?.plan_json ?? '{}')) as {
              segmentFirstNodePutDown?: unknown
            }
            if (Array.isArray(rawPlan.segmentFirstNodePutDown)) {
              segInit = rawPlan.segmentFirstNodePutDown.map((x) => x === true || x === 'true')
            }
          } catch {
            /* ignore */
          }
          while (segInit.length < draft.length) segInit.push(false)
          const segTrim = segInit.slice(0, draft.length)
          setDraftDestinations(draft)
          setDraftPickupContinue(pc)
          setDraftSegFirstPutDown(segTrim)
          setSavedPlanSnapshot(planEditSnapshot(draft, pc, segTrim))
        } else {
          setDraftDestinations(null)
          setDraftPickupContinue(null)
          setDraftSegFirstPutDown([])
          setSavedPlanSnapshot('')
        }
      })
      .catch(() => {
        if (!cancelled) setMsErr('Could not load multi-stop session')
      })
      .finally(() => {
        if (!cancelled) setMsLoading(false)
      })
    return () => {
      cancelled = true
    }
    /** When `sessionId` is unchanged, refetch is silent (no msLoading) — see sessionIdChanged above. */
  }, [sessionId, msRefresh, record?.updated_at, record?.last_status])

  const nextSegmentIndex = useMemo(() => {
    if (!msData?.session) return 0
    const n = Number(msData.session.next_segment_index)
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  }, [msData])


  /** Resolved plan for leg labels: prefer live draft, else session snapshot. */
  const planPlainForLegLabels = useMemo((): MultistopPlanDest[] | null => {
    if (draftDestinations?.length) {
      return draftDestinations.map((r) => ({
        position: r.position,
        continueMode: r.continueMode,
        autoContinueSeconds: r.autoContinueSeconds,
        putDown: r.putDown,
        groupId: r.groupId,
      }))
    }
    return parsePlanDestinations(msData?.session?.plan_json)
  }, [draftDestinations, msData?.session?.plan_json])

  /** More than two physical stops (pickup + two or more destinations): show “Multi-stop” vs “Route”. */
  const chainMultistopRoute = useMemo(() => {
    if (draftDestinations != null && draftDestinations.length > 0) {
      return draftDestinations.length > 1
    }
    const ts = msData?.session?.total_segments
    if (ts != null && Number.isFinite(Number(ts))) return Number(ts) > 1
    return Number(record?.multistop_segment_count ?? 0) > 1
  }, [draftDestinations, msData?.session?.total_segments, record?.multistop_segment_count])

  useEffect(() => {
    if (!draftDestinations) {
      setDraftSegFirstPutDown([])
      return
    }
    const n = draftDestinations.length
    setDraftSegFirstPutDown((prev) => {
      const next = prev.slice(0, n)
      while (next.length < n) next.push(false)
      return next
    })
  }, [draftDestinations])

  const hasPlanChanges = useMemo(() => {
    if (!draftDestinations) return false
    return (
      planEditSnapshot(draftDestinations, draftPickupContinue, draftSegFirstPutDown) !== savedPlanSnapshot
    )
  }, [draftDestinations, draftPickupContinue, draftSegFirstPutDown, savedPlanSnapshot])

  const pickupPos = useMemo(() => {
    if (msData?.session?.pickup_position != null) return String(msData.session.pickup_position)
    return null
  }, [msData?.session?.pickup_position])

  const routePlanStandRefs = useMemo(() => {
    if (!sessionId || !planPlainForLegLabels?.length) return [] as string[]
    const set = new Set<string>()
    const n = planPlainForLegLabels.length
    for (let i = 0; i < n; i += 1) {
      const { start, end } = segmentLegEndpoints(
        i,
        planPlainForLegLabels,
        pickupPos,
        standGroupNameById
      )
      const a = start.trim()
      const b = end.trim()
      if (a && a !== '—' && isHyperionPollableStandRef(a)) set.add(a)
      if (b && b !== '—' && isHyperionPollableStandRef(b)) set.add(b)
    }
    return [...set].sort()
  }, [sessionId, planPlainForLegLabels, pickupPos, standGroupNameById])

  const routePlanStandRefsKey = routePlanStandRefs.join('\0')

  const planForContinueOccupiedRef = useMemo((): MultistopReleasePlanDest[] | null => {
    if (draftDestinations?.length) {
      return normalizeDraftPutDownRows(draftDestinations).map((r) => ({
        position: r.position.trim(),
        putDown: r.putDown === true,
      }))
    }
    return parseMultistopReleasePlanDestinations(msData?.session?.plan_json)
  }, [draftDestinations, msData?.session?.plan_json])

  const nextContinueOccupiedCheckRef = useMemo(() => {
    if (!planForContinueOccupiedRef?.length || !Number.isFinite(nextSegmentIndex)) return null
    return multistopContinueOccupiedDestinationRef(planForContinueOccupiedRef, nextSegmentIndex)
  }, [planForContinueOccupiedRef, nextSegmentIndex])

  /** Includes next Continue drop + blocked stand so release gating and maps stay fresh while polling. */
  const presencePollStandRefs = useMemo(() => {
    const set = new Set<string>()
    for (const r of routePlanStandRefs) {
      const t = r.trim()
      if (t) set.add(t)
    }
    const nc = nextContinueOccupiedCheckRef?.trim()
    if (nc) set.add(nc)
    const cb = continueBlockedStandRef?.trim()
    if (cb) set.add(cb)
    return [...set].sort()
  }, [routePlanStandRefsKey, nextContinueOccupiedCheckRef, continueBlockedStandRef])

  const presencePollStandRefsKey = presencePollStandRefs.join('\0')

  const continueReleaseDisabledUntilStandEmpty = useMemo(
    () =>
      multistopContinueReleaseDisabledUntilStandShowsEmpty({
        sanityEnabled: standPresenceSanityOn,
        nextOccupiedCheckRef: nextContinueOccupiedCheckRef,
        bypassRefs: palletPresenceBypassRefs,
        presenceMap: routeStandPresenceMap,
        routePresenceUnconfig: routeStandPresenceUnconfig,
        routePresenceError: routeStandPresenceError,
      }),
    [
      standPresenceSanityOn,
      nextContinueOccupiedCheckRef,
      palletPresenceBypassRefs,
      routeStandPresenceMap,
      routeStandPresenceUnconfig,
      routeStandPresenceError,
    ]
  )

  const loadRoutePlanPresence = useCallback(
    async (refs: string[], opts?: { silent?: boolean }) => {
      if (refs.length === 0) return
      const silent = opts?.silent === true
      if (!silent) {
        setRouteStandPresenceLoading(true)
        setRouteStandPresenceError(false)
        setRouteStandPresenceUnconfig(false)
      }
      try {
        const map = await postStandPresence(refs)
        setRouteStandPresenceMap((prev) => {
          const next = { ...prev }
          for (const r of refs) {
            next[r] = Object.prototype.hasOwnProperty.call(map, r) ? map[r] : null
          }
          return next
        })
        setRouteStandPresenceError(false)
        setRouteStandPresenceUnconfig(false)
      } catch (e: unknown) {
        if (silent) return
        const status = (e as { response?: { status?: number } })?.response?.status
        if (status === 503) setRouteStandPresenceUnconfig(true)
        else setRouteStandPresenceError(true)
      } finally {
        if (!silent) setRouteStandPresenceLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (presencePollStandRefs.length === 0) return
    void loadRoutePlanPresence(presencePollStandRefs, { silent: true })
  }, [presencePollStandRefsKey, loadRoutePlanPresence, presencePollStandRefs])

  useEffect(() => {
    if (presencePollStandRefs.length === 0) return
    const tid = window.setInterval(() => {
      void loadRoutePlanPresence(presencePollStandRefs, { silent: true })
    }, pollMsContainers)
    return () => clearInterval(tid)
  }, [presencePollStandRefsKey, loadRoutePlanPresence, presencePollStandRefs, pollMsContainers])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (presencePollStandRefs.length === 0) return
      void loadRoutePlanPresence(presencePollStandRefs, { silent: true })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [presencePollStandRefsKey, loadRoutePlanPresence, presencePollStandRefs])

  const routeStandPresenceUi = useMemo(
    () =>
      sessionId && msData && planPlainForLegLabels && planPlainForLegLabels.length > 0
        ? {
            map: routeStandPresenceMap,
            loading: routeStandPresenceLoading,
            error: routeStandPresenceError,
            unconfigured: routeStandPresenceUnconfig,
            bypassRefs: palletPresenceBypassRefs,
          }
        : undefined,
    [
      sessionId,
      msData,
      planPlainForLegLabels,
      routeStandPresenceMap,
      routeStandPresenceLoading,
      routeStandPresenceError,
      routeStandPresenceUnconfig,
      palletPresenceBypassRefs,
    ]
  )

  const removeDraftRow = useCallback(
    (id: string) => {
      setDraftDestinations((prev) => {
        if (!prev) return prev
        if (prev.length <= nextSegmentIndex + 1) return prev
        return normalizeDraftPutDownRows(prev.filter((r) => r.id !== id))
      })
    },
    [nextSegmentIndex]
  )

  const closeRouteStopModal = useCallback(() => {
    setRouteStopModal(null)
    setAddStopErr(null)
    setAddStopSuggestOpen(false)
    setAddStopPickerOpen(false)
    setAddStopGroupId(null)
    cancelAddStopSuggestClose()
  }, [cancelAddStopSuggestClose])

  const openAddStopModal = useCallback(() => {
    setAddStopErr(null)
    setAddStopPosition('')
    setAddStopGroupId(null)
    setAddStopContinueMode('manual')
    setAddStopAutoSeconds(0)
    setRouteStopPutDown(true)
    setAddStopSuggestOpen(false)
    setAddStopPickerOpen(false)
    cancelAddStopSuggestClose()
    setRouteStopModal({ mode: 'add' })
  }, [cancelAddStopSuggestClose])

  const openEditStopModal = useCallback(
    (rowId: string) => {
      const row = draftDestinations?.find((r) => r.id === rowId)
      if (!row) return
      const idx = draftDestinations?.findIndex((r) => r.id === rowId) ?? -1
      const isFinal = draftDestinations != null && idx >= 0 && idx >= draftDestinations.length - 1
      setAddStopErr(null)
      setAddStopPosition(row.position)
      setAddStopGroupId(row.groupId?.trim() || null)
      setAddStopContinueMode(row.continueMode === 'auto' ? 'auto' : 'manual')
      setAddStopAutoSeconds(row.autoContinueSeconds ?? 0)
      setRouteStopPutDown(isFinal ? true : row.putDown === true)
      setAddStopSuggestOpen(false)
      setAddStopPickerOpen(false)
      cancelAddStopSuggestClose()
      setRouteStopModal({ mode: 'edit', rowId })
    },
    [draftDestinations, cancelAddStopSuggestClose]
  )

  const persistPlanFromDraftRows = useCallback(async (rows: DraftDest[]): Promise<boolean> => {
    if (!sessionId) return false
    const plan = draftToPlan(rows)
    const err = validateMultistopPlan(rows)
    const pErr =
      nextSegmentIndex === 0 && draftPickupContinue != null
        ? validatePickupContinueDraft(draftPickupContinue)
        : null
    if (err || pErr) {
      setPlanEditErr(err ?? pErr ?? null)
      return false
    }
    setPlanEditErr(null)
    setPatchBusy(true)
    try {
      const body: Record<string, unknown> = {
        destinations: plan,
        segmentFirstNodePutDown: draftSegFirstPutDown,
      }
      if (nextSegmentIndex === 0 && draftPickupContinue) {
        const pc = draftPickupContinue
        if (pc.continueMode === 'auto') {
          body.pickupContinue = {
            continueMode: 'auto',
            autoContinueSeconds: Math.min(
              86400,
              Math.max(0, Math.floor(pc.autoContinueSeconds ?? 0))
            ),
          }
        } else {
          body.pickupContinue = { continueMode: 'manual' }
        }
      }
      if (overrideSpecialLocations) body.override = true
      await patchAmrMultistopSession(sessionId, body)
      setSavedPlanSnapshot(planEditSnapshot(rows, draftPickupContinue, draftSegFirstPutDown))
      return true
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setPlanEditErr(ax?.response?.data?.error ?? 'Save failed')
      return false
    } finally {
      setPatchBusy(false)
    }
  }, [sessionId, nextSegmentIndex, draftPickupContinue, draftSegFirstPutDown, overrideSpecialLocations])

  const handleTailDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      setDraftDestinations((prev) => {
        if (!prev) return prev
        const tail = prev.slice(nextSegmentIndex)
        const oldIdx = tail.findIndex((r) => r.id === active.id)
        const newIdx = tail.findIndex((r) => r.id === over.id)
        if (oldIdx < 0 || newIdx < 0) return prev
        const head = prev.slice(0, nextSegmentIndex)
        const nextRows = normalizeDraftPutDownRows([...head, ...arrayMove(tail, oldIdx, newIdx)])
        void persistPlanFromDraftRows(nextRows)
        return nextRows
      })
    },
    [nextSegmentIndex, persistPlanFromDraftRows]
  )

  const commitRouteStopModal = useCallback(() => {
    if (!routeStopModal) return
    const modal = routeStopModal
    const gid = addStopGroupId?.trim() ?? ''
    const pos = normalizeExternalRefFromStands(standRows, addStopPosition)
    if (!gid && !pos.trim()) {
      setAddStopErr('Enter an External Ref for this stop or pick a stand group.')
      return
    }

    const cm = addStopContinueMode
    const sec = cm === 'auto' ? Math.min(86400, Math.max(0, Math.floor(addStopAutoSeconds))) : 0

    let si = -1
    let isFinal = false
    if (modal.mode === 'edit') {
      si = draftDestinations?.findIndex((r) => r.id === modal.rowId) ?? -1
      isFinal =
        draftDestinations != null && si >= 0 && si >= draftDestinations.length - 1
    }
    const releaseUiActive = modal.mode === 'add' || (modal.mode === 'edit' && !isFinal)
    if (releaseUiActive && cm === 'auto') {
      const s = addStopAutoSeconds
      if (!Number.isFinite(s) || s < 0 || s > 86400) {
        setAddStopErr('Auto Release needs 0–86400 seconds.')
        return
      }
    }

    const effectivePutDown = modal.mode === 'edit' && isFinal ? true : routeStopPutDown
    const restriction =
      gid && !pos.trim()
        ? { violated: false, message: '' }
        : legRestrictionStatus(standRows, pos, effectivePutDown)
    if (restriction.violated && !overrideSpecialLocations) {
      setAddStopErr(
        canOverrideSpecial
          ? `${restriction.message} Tick "Override restriction" to proceed.`
          : restriction.message
      )
      return
    }

    const palletDrop = routeStopPutDown

    closeRouteStopModal()

    if (modal.mode === 'add') {
      const id = uuidv4()
      const row: DraftDest = {
        id,
        position: pos,
        putDown: true,
        continueMode: cm,
        ...(cm === 'auto' ? { autoContinueSeconds: sec } : {}),
      }
      if (gid) row.groupId = gid
      setDraftDestinations((prev) => {
        if (!prev) return prev
        const newRows = normalizeDraftPutDownRows([...prev, row])
        queueMicrotask(() => {
          void persistPlanFromDraftRows(newRows)
        })
        return newRows
      })
      return
    }

    const rowId = modal.rowId
    setDraftDestinations((prev) => {
      if (!prev) return prev
      const next = normalizeDraftPutDownRows(
        prev.map((r) => {
          if (r.id !== rowId) return r
          if (isFinal) {
            const u: DraftDest = { ...r, position: pos }
            if (gid) u.groupId = gid
            else delete u.groupId
            return u
          }
          if (cm === 'auto') {
            const u: DraftDest = {
              ...r,
              position: pos,
              putDown: palletDrop,
              continueMode: 'auto' as const,
              autoContinueSeconds: sec,
            }
            if (gid) u.groupId = gid
            else delete u.groupId
            return u
          }
          const u: DraftDest = {
            ...r,
            position: pos,
            putDown: palletDrop,
            continueMode: 'manual' as const,
          }
          if (gid) u.groupId = gid
          else delete u.groupId
          return u
        })
      )
      queueMicrotask(() => {
        void persistPlanFromDraftRows(next)
      })
      return next
    })
  }, [
    routeStopModal,
    addStopPosition,
    addStopGroupId,
    addStopContinueMode,
    addStopAutoSeconds,
    standRows,
    closeRouteStopModal,
    persistPlanFromDraftRows,
    draftDestinations,
    routeStopPutDown,
    overrideSpecialLocations,
    canOverrideSpecial,
  ])

  const addStopSuggestedStands = useMemo(() => {
    if (!routeStopModal || addStopGroupId) return []
    return filterStandsForSuggest(standRows, addStopPosition)
  }, [routeStopModal, standRows, addStopPosition, addStopGroupId])

  const editStopSegmentIndex =
    routeStopModal?.mode === 'edit' && draftDestinations
      ? draftDestinations.findIndex((r) => r.id === routeStopModal.rowId)
      : -1
  const editStopIsFinal =
    editStopSegmentIndex >= 0 &&
    draftDestinations != null &&
    editStopSegmentIndex >= draftDestinations.length - 1
  const showRouteModalReleaseControls =
    routeStopModal?.mode === 'add' || (routeStopModal?.mode === 'edit' && !editStopIsFinal)
  /** Add-stop appends a final destination; editing a middle stop can toggle pickup vs drop. */
  const showRouteModalPutDownToggle =
    routeStopModal?.mode === 'edit' && draftDestinations != null && !editStopIsFinal

  /** Same mode logic as {@link AmrMissionNew} stand picker — pickup / dropoff / any by segment role and pallet toggle. */
  const routeStopStandPickerMode = useMemo((): AmrStandPickerMode => {
    if (!draftDestinations?.length || !routeStopModal) return 'dropoff'
    if (routeStopModal.mode === 'add') return 'dropoff'
    const idx = draftDestinations.findIndex((r) => r.id === routeStopModal.rowId)
    if (idx < 0) return 'dropoff'
    const total = draftDestinations.length
    if (total === 1 || idx === 0) return 'dropoff'
    if (idx >= total - 1) return 'dropoff'
    const prev = draftDestinations[idx - 1]
    const departDrop = prev?.putDown === true
    const arriveDrop = routeStopPutDown
    if (departDrop !== arriveDrop) return 'any'
    return arriveDrop ? 'dropoff' : 'pickup'
  }, [draftDestinations, routeStopModal, routeStopPutDown])

  const sessionStatus = multistopSessionStatusFromSources(
    msData?.session != null ? (msData.session as Record<string, unknown>) : null,
    record
  )
  const awaitingContinue = sessionStatus === 'awaiting_continue'
  /** Show force release when Release cannot dispatch: API failure, failed session, occupied stand (sanity), or blocked ref. */
  const showForceReleaseForMissionError =
    sessionStatus === 'failed' ||
    continueApiFailed ||
    continueReleaseDisabledUntilStandEmpty ||
    Boolean(continueBlockedStandRef?.trim())
  const continueNotBeforeRaw = msData?.session?.continue_not_before
  const continueNotBeforeIso =
    typeof continueNotBeforeRaw === 'string' && continueNotBeforeRaw.trim()
      ? continueNotBeforeRaw.trim()
      : null
  const autoContinueWaitMs = continueNotBeforeIso ? remainingMsUntilIso(continueNotBeforeIso) : null
  const [, setCountdownTick] = useState(0)
  useEffect(() => {
    if (!awaitingContinue || !continueNotBeforeIso) return
    const ms = remainingMsUntilIso(continueNotBeforeIso)
    /** No ticking for immediate (0s) auto-continue — avoids a stuck "0s" countdown. */
    if (ms == null || ms === 0) return
    const t = setInterval(() => setCountdownTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [awaitingContinue, continueNotBeforeIso])

  const pickupContinueHint = useMemo(
    () => parsePickupContinueFromPlanJson(msData?.session?.plan_json),
    [msData?.session?.plan_json]
  )

  const missionLogsTo = useMemo(() => {
    if (!record) return amrPath('logs')
    const params = new URLSearchParams()
    const rid = String(record.id ?? '').trim()
    if (rid) params.set('missionRecordId', rid)
    const jc =
      String(record.job_code ?? '').trim() || String(record.mission_code ?? '').trim()
    const sid = String(record.multistop_session_id ?? '').trim()
    const parts = [jc, sid].filter((p) => p.length > 0)
    const q = parts.join(' ').trim()
    if (q) params.set('q', q)
    const qs = params.toString()
    return qs ? `${amrPath('logs')}?${qs}` : amrPath('logs')
  }, [record])

  const loadBlockedDestinationPresence = useCallback(async (opts?: { silent?: boolean }) => {
    const ref = continueBlockedStandRef?.trim()
    if (!ref) return
    const silent = opts?.silent === true
    if (!silent) {
      setBlockedDestPresenceLoading(true)
      setBlockedDestPresenceError(false)
      setBlockedDestPresenceUnconfig(false)
    }
    try {
      const p = await postStandPresence([ref])
      const v = p[ref]
      setBlockedDestPresence(typeof v === 'boolean' ? v : null)
      if (!silent) {
        setBlockedDestPresenceError(false)
        setBlockedDestPresenceUnconfig(false)
      }
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (!silent) {
        if (status === 503) setBlockedDestPresenceUnconfig(true)
        else setBlockedDestPresenceError(true)
        setBlockedDestPresence(null)
      }
    } finally {
      if (!silent) setBlockedDestPresenceLoading(false)
    }
  }, [continueBlockedStandRef])

  useEffect(() => {
    if (!continueBlockedStandRef) {
      setBlockedDestPresence(null)
      setBlockedDestPresenceLoading(false)
      setBlockedDestPresenceError(false)
      setBlockedDestPresenceUnconfig(false)
      return
    }
    void loadBlockedDestinationPresence()
  }, [continueBlockedStandRef, loadBlockedDestinationPresence])

  useEffect(() => {
    const ref = continueBlockedStandRef?.trim()
    if (!ref) return
    const tid = window.setInterval(() => {
      void loadBlockedDestinationPresence({ silent: true })
    }, pollMsContainers)
    return () => clearInterval(tid)
  }, [continueBlockedStandRef, loadBlockedDestinationPresence, pollMsContainers])

  useEffect(() => {
    if (!continueBlockedStandRef?.trim()) return
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void loadBlockedDestinationPresence({ silent: true })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [continueBlockedStandRef, loadBlockedDestinationPresence])

  useEffect(() => {
    setStandOccupiedModalDismissed(false)
  }, [continueBlockedStandRef])

  /** Matches footer “Release Mission” / “Release now” wording for Retry in the stand-occupied dialog. */
  const standOccupiedReleaseRetryLabel = continueNotBeforeIso ? 'Release now' : 'Release Mission'

  if (!record) return null

  const hideStandOccupiedInlineAlert =
    Boolean(continueBlockedStandRef) && !standOccupiedModalDismissed

  const payload = parsePayload(record)
  const steps = missionSteps(payload)
  const enterPos = containerInSummary(payload)
  const payloadRobotIds = submitRobotIdsFromPayload(payload)
  const unlockRobotFromPayload = unlockRobotIdFromPayload(payload)
  const jobCode = String(record.job_code ?? '')
  const missionCode = String(record.mission_code ?? '')
  const createdRaw = record.created_at
  const updatedRaw = record.updated_at
  const createdAt =
    typeof createdRaw === 'string' || createdRaw instanceof Date ? formatDateTime(createdRaw as string | Date) : '—'
  const updatedAt =
    typeof updatedRaw === 'string' || updatedRaw instanceof Date ? formatDateTime(updatedRaw as string | Date) : '—'

  /** Plan patch, reorder, add/edit/remove stops — any time the multistop session is `active` or `awaiting_continue`. */
  const routePlanEditable =
    canManage && (sessionStatus === 'active' || sessionStatus === 'awaiting_continue')

  const lockedRobotFromSession =
    sessionId && msData?.session && typeof msData.session.locked_robot_id === 'string'
      ? msData.session.locked_robot_id.trim()
      : ''
  /** Single-move missions: fleet `jobQuery` updates this on the mission record (see mission worker). */
  const lockedRobotFromRecord =
    typeof record.locked_robot_id === 'string' && record.locked_robot_id.trim()
      ? record.locked_robot_id.trim()
      : ''
  const sessionContainerFromMs =
    sessionId && msData?.session && typeof msData.session.container_code === 'string'
      ? msData.session.container_code.trim()
      : ''
  const containerDisplayPrimary =
    String(record.container_code ?? '').trim() || sessionContainerFromMs || ''
  /** Session lock is cleared when the next segment starts; use this segment’s unlockRobotId from stored submit payload. */
  const robotDisplayPrimary =
    lockedRobotFromSession ||
    lockedRobotFromRecord ||
    unlockRobotFromPayload ||
    (payloadRobotIds.length > 0 ? payloadRobotIds.join(', ') : '')
  const robotPrimaryHeading = lockedRobotFromSession
    ? 'Robot (session)'
    : lockedRobotFromRecord
      ? 'Robot (assigned)'
      : unlockRobotFromPayload
        ? 'Robot (this stop)'
        : 'Robot(s)'
  const fleetPoolStr = payloadRobotIds.join(', ')
  const showFleetPoolLine =
    payloadRobotIds.length > 0 && fleetPoolStr !== robotDisplayPrimary && Boolean(robotDisplayPrimary)

  const persistPlanToServer = async (): Promise<boolean> => {
    if (!draftDestinations) return false
    return persistPlanFromDraftRows(draftDestinations)
  }

  const onContinue = async () => {
    if (!sessionId || !draftDestinations) return
    setContinueBusy(true)
    setMsErr(null)
    setContinueApiFailed(false)
    setContinueBlockedStandRef(null)
    setPlanEditErr(null)
    try {
      if (hasPlanChanges) {
        const ok = await persistPlanToServer()
        if (!ok) return
      }
      if ((await getAmrSettings()).missionCreateStandPresenceSanityCheck !== false) {
        const planFromDraft: MultistopReleasePlanDest[] = normalizeDraftPutDownRows(draftDestinations).map((r) => ({
          position: r.position.trim(),
          putDown: r.putDown === true,
        }))
        const ref = multistopContinueOccupiedDestinationRef(planFromDraft, nextSegmentIndex)
        if (ref && !refBypassesPalletCheck(ref, palletPresenceBypassRefs)) {
          const presence = await postStandPresence([ref])
          if (presence[ref] === true) {
            setMsErr(multistopStandOccupiedContinueMessage(ref))
            setContinueBlockedStandRef(ref)
            return
          }
        }
      }
      await continueAmrMultistopSession(sessionId)
      setContinueApiFailed(false)
      setContinueBlockedStandRef(null)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      setContinueApiFailed(true)
      setMsErr(getApiErrorMessage(e, 'Continue failed'))
      setContinueBlockedStandRef(parseMultistopContinueStandOccupied(e))
    } finally {
      setContinueBusy(false)
    }
  }

  const onConfirmForceRelease = async () => {
    if (!sessionId) return
    setForceReleaseConfirmOpen(false)
    setContinueBusy(true)
    setMsErr(null)
    setContinueApiFailed(false)
    try {
      if (hasPlanChanges) {
        const ok = await persistPlanToServer()
        if (!ok) return
      }
      await continueAmrMultistopSession(sessionId, { forceRelease: true })
      setContinueApiFailed(false)
      setContinueBlockedStandRef(null)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      setContinueApiFailed(true)
      setMsErr(getApiErrorMessage(e, 'Force release failed'))
      setContinueBlockedStandRef(parseMultistopContinueStandOccupied(e))
    } finally {
      setContinueBusy(false)
    }
  }

  const terminateStuckEnabled = canManage && Boolean(sessionId) && sessionStatus === 'failed'

  const onTerminateStuckSession = async () => {
    if (!sessionId || !terminateStuckEnabled) return
    setTerminateStuckBusy(true)
    setMsErr(null)
    setContinueApiFailed(false)
    try {
      await terminateStuckAmrMultistopSession(sessionId)
      setTerminateStuckConfirmOpen(false)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      setMsErr(getApiErrorMessage(e, 'Could not end failed session'))
    } finally {
      setTerminateStuckBusy(false)
    }
  }

  const tailDestRows = draftDestinations?.slice(nextSegmentIndex) ?? []
  const canRemoveNext = (draftDestinations?.length ?? 0) > nextSegmentIndex + 1
  const firstTailId = tailDestRows[0]?.id
  /** Full route size must follow the live draft so “Stop N of M” updates when adding/removing stops. */
  const routeTotalStops =
    draftDestinations != null && draftDestinations.length > 0
      ? draftDestinations.length
      : msData?.session?.total_segments != null && Number.isFinite(Number(msData.session.total_segments))
        ? Number(msData.session.total_segments)
        : planPlainForLegLabels?.length ?? msData?.records?.length ?? 0

  const forceReleaseStandRefForConfirm =
    (continueBlockedStandRef ?? nextContinueOccupiedCheckRef)?.trim() || null

  const missionRecordPk = record ? String(record.id ?? '').trim() : ''
  const isQueuedMission = Number(record?.queued) === 1
  const queuedDestRef =
    typeof record?.queued_destination_ref === 'string' ? record.queued_destination_ref.trim() : ''
  const queuedAtIso = typeof record?.queued_at === 'string' ? record.queued_at.trim() : ''
  const presenceWarnIso =
    typeof record?.presence_warning_at === 'string' ? record.presence_warning_at.trim() : ''
  const presenceDestRef =
    typeof record?.presence_dest_ref === 'string' ? record.presence_dest_ref.trim() : ''

  const routeNextLegQueued = missionOverviewOrDetailQueuedHue({
    flat: record,
    session: msData?.session ? (msData.session as Record<string, unknown>) : null,
  })

  const onConfirmQueuedMissionForce = async () => {
    if (!missionRecordPk) return
    setQueuedMissionForceOpen(false)
    setQueuedMissionForceBusy(true)
    setMsErr(null)
    try {
      await forceReleaseMission(missionRecordPk)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      setMsErr(getApiErrorMessage(e, 'Force dispatch failed'))
    } finally {
      setQueuedMissionForceBusy(false)
    }
  }

  const onAckPresenceWarning = async () => {
    if (!missionRecordPk) return
    setAckPresenceBusy(true)
    setMsErr(null)
    try {
      await ackPresenceWarning(missionRecordPk)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      setMsErr(getApiErrorMessage(e, 'Could not acknowledge warning'))
    } finally {
      setAckPresenceBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-detail-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ConfirmModal
          open={queuedMissionForceOpen}
          title="Force dispatch queued mission"
          variant="amber"
          message={
            queuedDestRef ? (
              <span>
                Dispatch <span className="font-mono">{missionRecordPk}</span> to fleet now, even if stand{' '}
                <span className="font-mono">{queuedDestRef}</span> still appears occupied?
              </span>
            ) : (
              `Dispatch mission ${missionRecordPk} now without waiting for queue policy? Only if the destination is safe.`
            )
          }
          confirmLabel={queuedMissionForceBusy ? 'Dispatching…' : 'Force dispatch'}
          cancelLabel="Cancel"
          onCancel={() => {
            if (!queuedMissionForceBusy) setQueuedMissionForceOpen(false)
          }}
          onConfirm={() => void onConfirmQueuedMissionForce()}
        />
        <ConfirmModal
          open={forceReleaseConfirmOpen}
          title="Force release"
          variant="amber"
          message={
            forceReleaseStandRefForConfirm ? (
              <span>
                Hyperion still reports a pallet at stand{' '}
                <span className="font-mono">{forceReleaseStandRefForConfirm}</span>. Force only if the stand is actually
                clear or you accept the risk of a fleet conflict.
              </span>
            ) : (
              'Force dispatch without a stand-empty check? Only continue if the stand is clear or you accept the risk.'
            )
          }
          confirmLabel={continueBusy ? 'Releasing…' : 'Force release'}
          cancelLabel="Cancel"
          onCancel={() => {
            if (!continueBusy) setForceReleaseConfirmOpen(false)
          }}
          onConfirm={() => void onConfirmForceRelease()}
        />
        <ConfirmModal
          open={terminateStuckConfirmOpen}
          title="End failed session"
          message={
            <span>
              This session is marked <strong className="font-medium">failed</strong> and cannot Continue. DC will stop
              tracking it, close all related mission rows, and call fleet <strong className="font-medium">missionCancel</strong>{' '}
              for each segment job code (best effort). Confirm only when robots are safe.
            </span>
          }
          confirmLabel={terminateStuckBusy ? 'Ending…' : 'End session'}
          variant="danger"
          onCancel={() => {
            if (!terminateStuckBusy) setTerminateStuckConfirmOpen(false)
          }}
          onConfirm={() => void onTerminateStuckSession()}
        />
        <AmrStandOccupiedContinueModal
          open={Boolean(continueBlockedStandRef) && !standOccupiedModalDismissed}
          standRef={continueBlockedStandRef ?? ''}
          message={
            msErr ??
            (continueBlockedStandRef
              ? multistopStandOccupiedContinueMessage(continueBlockedStandRef)
              : 'Stand occupied.')
          }
          presence={{
            present: blockedDestPresence,
            loading: blockedDestPresenceLoading,
            error: blockedDestPresenceError,
            unconfigured: blockedDestPresenceUnconfig,
          }}
          canForceRelease={canForceRelease && showForceReleaseForMissionError}
          continueBusy={continueBusy}
          confirmDisabled={patchBusy || continueReleaseDisabledUntilStandEmpty}
          retryLabel={standOccupiedReleaseRetryLabel}
          onDismiss={() => setStandOccupiedModalDismissed(true)}
          onRetry={() => void onContinue()}
          onRefreshPresence={() => void loadBlockedDestinationPresence()}
          onRequestForceRelease={() => {
            setStandOccupiedModalDismissed(true)
            setForceReleaseConfirmOpen(true)
          }}
        />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p id="mission-detail-title" className="text-xs font-medium uppercase tracking-wide text-foreground/55">
              Mission
            </p>
            <p className="mt-1 break-all font-mono text-base font-semibold leading-snug text-foreground">
              {jobCode || missionCode || '—'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {record.last_status != null ? (
                <MissionJobStatusBadge value={record.last_status} />
              ) : (
                <span className="text-sm text-foreground/50">No status yet</span>
              )}
              <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                {String(record.mission_type ?? 'RACK_MOVE')}
              </span>
              {sessionId ? (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {chainMultistopRoute ? 'Multi-stop' : 'Route'}
                </span>
              ) : null}
              {sessionStatus ? (
                <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground/75">
                  {friendlyMultistopSessionStatus(sessionStatus)}
                </span>
              ) : null}
            </div>
            {isQueuedMission && missionRecordPk ? (
              <div
                className={`mt-3 rounded-lg px-3 py-2.5 text-sm leading-snug text-foreground ${MISSION_QUEUED_CALLOUT_CLASS}`}
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-violet-950 dark:text-violet-100/90">
                  Queued for destination
                </p>
                <p className="mt-1 break-all font-mono text-xs">{queuedDestRef || '—'}</p>
                {queuedAtIso ? (
                  <p className="mt-1 text-xs text-foreground/65">Queued since {formatDateTime(queuedAtIso)}</p>
                ) : null}
                {canForceRelease ? (
                  <button
                    type="button"
                    disabled={queuedMissionForceBusy}
                    className="mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-500/16 disabled:opacity-50 dark:text-amber-100"
                    onClick={() => setQueuedMissionForceOpen(true)}
                  >
                    Force dispatch…
                  </button>
                ) : null}
              </div>
            ) : null}
            {presenceWarnIso && missionRecordPk ? (
              <div className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2.5 text-sm leading-snug text-foreground">
                <p className="text-[11px] font-medium uppercase tracking-wide text-amber-950 dark:text-amber-100">
                  Drop presence warning
                </p>
                <p className="mt-1 text-xs text-foreground/80">
                  Hyperion still reports a pallet at{' '}
                  {presenceDestRef ? <span className="font-mono">{presenceDestRef}</span> : 'the drop stand'} after the
                  post-drop check window (warned at {formatDateTime(presenceWarnIso)}).
                </p>
                {canForceRelease ? (
                  <button
                    type="button"
                    disabled={ackPresenceBusy}
                    className="mt-2 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                    onClick={() => void onAckPresenceWarning()}
                  >
                    {ackPresenceBusy ? 'Acknowledging…' : 'Acknowledge (clear warning)'}
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-foreground/55">Operators with mission force-release permission can acknowledge.</p>
                )}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">Container</p>
                <p className="mt-0.5 break-all font-mono text-sm font-semibold text-foreground">
                  {containerDisplayPrimary || '—'}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">
                  {robotPrimaryHeading}
                </p>
                <p className="mt-0.5 break-all font-mono text-sm font-semibold text-foreground">
                  {robotDisplayPrimary || '—'}
                </p>
                {showFleetPoolLine ? (
                  <p className="mt-1 text-[11px] leading-snug text-foreground/55">
                    Fleet pool:{' '}
                    <span className="font-mono text-foreground/70">{fleetPoolStr}</span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {sessionId && presencePollStandRefs.length > 0 ? (
              <div className="flex max-w-[min(100vw-6rem,16rem)] flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right sm:max-w-none">
                {routeStandPresenceUnconfig ? (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Hyperion not configured
                  </span>
                ) : routeStandPresenceError ? (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Stand status error
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="flex shrink-0 items-center gap-2">
              {sessionId && presencePollStandRefs.length > 0 ? (
                <button
                  type="button"
                  disabled={routeStandPresenceLoading}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground/80 hover:bg-muted disabled:opacity-50"
                  onClick={() => void loadRoutePlanPresence(presencePollStandRefs)}
                  title="Refresh pallet presence for route stands and the next Continue destination"
                >
                  {routeStandPresenceLoading ? 'Refreshing…' : 'Refresh stands'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-background hover:text-foreground"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {sessionId ? (
            <section className="space-y-3 rounded-lg border border-border bg-card px-3 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/55">
                {chainMultistopRoute ? 'Multi-stop route' : 'Route'}
              </h3>
              {msLoading ? <p className="text-sm text-foreground/60">Loading session…</p> : null}
              {msErr && !hideStandOccupiedInlineAlert ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium leading-snug text-red-600 dark:border-red-500/35 dark:bg-red-950/40 dark:text-red-400"
                >
                  <p>{msErr}</p>
                  {continueBlockedStandRef ? (
                    <div className="mt-3 space-y-3 border-t border-red-500/25 pt-3 dark:border-red-500/20">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-xs text-foreground/75">
                            Current stand status{' '}
                            <span className="font-mono text-foreground">{continueBlockedStandRef}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background/80 px-2 py-1">
                            <PalletPresenceGlyph
                              kind={palletPresenceKindFromState({
                                present: blockedDestPresence,
                                loading: blockedDestPresenceLoading,
                                error: blockedDestPresenceError,
                                unconfigured: blockedDestPresenceUnconfig,
                              })}
                              showLabel
                              className="h-4 w-4"
                            />
                          </span>
                          <button
                            type="button"
                            disabled={blockedDestPresenceLoading || continueBusy}
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                            onClick={() => void loadBlockedDestinationPresence()}
                          >
                            {blockedDestPresenceLoading ? 'Refreshing…' : 'Refresh'}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={
                          continueBusy || patchBusy || continueReleaseDisabledUntilStandEmpty
                        }
                        className="min-h-[40px] w-full rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 sm:w-auto"
                        onClick={() => void onContinue()}
                      >
                        Retry
                      </button>
                      {canForceRelease && showForceReleaseForMissionError ? (
                        <button
                          type="button"
                          disabled={continueBusy || patchBusy}
                          className="min-h-[40px] w-full rounded-md border border-red-600/50 bg-background px-3 text-sm font-medium text-red-700 hover:bg-red-500/15 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/50 sm:w-auto"
                          onClick={() => setForceReleaseConfirmOpen(true)}
                        >
                          Force release anyway
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!msLoading && msData ? (
                <>
                  {terminateStuckEnabled ? (
                    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-950 dark:text-amber-100">
                      <p className="font-medium text-foreground">Session failed — Continue unavailable</p>
                      <p className="mt-1 text-xs text-foreground/85">
                        End this route in DC and request fleet missionCancel on each leg (best effort) so tracking stops.
                      </p>
                      <button
                        type="button"
                        disabled={terminateStuckBusy || continueBusy || patchBusy}
                        className="mt-3 min-h-[40px] rounded-lg border border-red-600/50 bg-background px-3 text-sm font-medium text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
                        onClick={() => setTerminateStuckConfirmOpen(true)}
                      >
                        End failed session…
                      </button>
                    </div>
                  ) : null}
                  {pickupPos ? (
                    <div className="space-y-2">
                      <p className="text-sm">
                        Pickup: <span className="font-mono">{pickupPos}</span>
                        {draftSegFirstPutDown.length > 0 ? (
                          <>
                            <span className="text-foreground/35"> &gt; </span>
                            <span className="text-[10px] font-semibold uppercase text-foreground/75">
                              {draftSegFirstPutDown[0] === true ? 'LOWER' : 'LIFT'}
                            </span>
                          </>
                        ) : null}
                      </p>
                      {routePlanEditable && nextSegmentIndex === 0 && draftPickupContinue ? (
                        <div className="rounded-lg border border-border bg-muted/25 px-3 py-2">
                          <p className="text-xs font-medium text-foreground/75">Before first leg</p>
                          <div className="mt-2 flex items-center gap-3">
                            <ToggleSwitch
                              checked={draftPickupContinue.continueMode === 'auto'}
                              onCheckedChange={(on) =>
                                setDraftPickupContinue((prev) => {
                                  const base = prev ?? defaultPickupContinueDraft()
                                  return {
                                    ...base,
                                    continueMode: on ? 'auto' : 'manual',
                                    autoContinueSeconds: base.autoContinueSeconds ?? 0,
                                  }
                                })
                              }
                              aria-label={
                                draftPickupContinue.continueMode === 'auto' ? 'Auto Release' : 'Manual Release'
                              }
                              size="sm"
                              className="shrink-0"
                            />
                            <span className="min-w-0 flex-1 text-xs text-foreground/85">
                              {draftPickupContinue.continueMode === 'auto' ? 'Auto Release' : 'Manual Release'}
                            </span>
                          </div>
                          {draftPickupContinue.continueMode === 'auto' ? (
                            <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground/85">
                              <span className="text-foreground/70">After</span>
                              <input
                                type="number"
                                min={0}
                                max={86400}
                                inputMode="numeric"
                                className="w-[5rem] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                                value={draftPickupContinue.autoContinueSeconds ?? 0}
                                onChange={(e) => {
                                  const n = Number(e.target.value)
                                  setDraftPickupContinue((prev) => ({
                                    ...(prev ?? defaultPickupContinueDraft()),
                                    continueMode: 'auto',
                                    autoContinueSeconds: Number.isFinite(n) ? n : 0,
                                  }))
                                }}
                              />
                              <span>s</span>
                            </label>
                          ) : null}
                        </div>
                      ) : pickupContinueHint ? (
                        <p className="text-xs text-foreground/65">{formatPickupReleaseLine(pickupContinueHint)}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div>
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                      Completed stops
                    </h4>
                    <ul className="space-y-1.5">
                      {[...msData.records]
                        .sort((a, b) => msStepIndex(a) - msStepIndex(b))
                        .map((rec) => {
                          const si = msStepIndex(rec)
                          const { start, end } = segmentLegEndpoints(
                            si,
                            planPlainForLegLabels,
                            pickupPos,
                            standGroupNameById
                          )
                          const completedDepart =
                            draftSegFirstPutDown.length > si ? draftSegFirstPutDown[si] === true : false
                          const completedArriveLower =
                            draftDestinations &&
                            draftDestinations.length > si &&
                            (si >= draftDestinations.length - 1
                              ? true
                              : draftDestinations[si].putDown === true)
                          return (
                            <li
                              key={String(rec.id)}
                              className="flex flex-col gap-1 rounded-md border border-border/80 bg-muted/20 px-2 py-1.5 text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-foreground/70">
                                  {String(rec.job_code ?? '')}
                                </span>
                                {rec.last_status != null ? (
                                  <MissionJobStatusBadge value={rec.last_status as number} />
                                ) : null}
                              </div>
                              {routeStandPresenceUi ? (
                                <div className="space-y-1 pt-0.5">
                                  <AmrStandPresenceRow
                                    label="From"
                                    standRef={start}
                                    presenceMap={routeStandPresenceUi.map}
                                    loading={routeStandPresenceUi.loading}
                                    error={routeStandPresenceUi.error}
                                    unconfigured={routeStandPresenceUi.unconfigured}
                                    bypassRefs={routeStandPresenceUi.bypassRefs}
                                    forkAction={
                                      draftDestinations && draftDestinations.length > si
                                        ? completedDepart
                                          ? 'lower'
                                          : 'lift'
                                        : undefined
                                    }
                                  />
                                  <AmrStandPresenceRow
                                    label="To"
                                    standRef={end}
                                    presenceMap={routeStandPresenceUi.map}
                                    loading={routeStandPresenceUi.loading}
                                    error={routeStandPresenceUi.error}
                                    unconfigured={routeStandPresenceUi.unconfigured}
                                    bypassRefs={routeStandPresenceUi.bypassRefs}
                                    forkAction={
                                      draftDestinations && draftDestinations.length > si
                                        ? Boolean(completedArriveLower)
                                          ? 'lower'
                                          : 'lift'
                                        : undefined
                                    }
                                  />
                                </div>
                              ) : (
                                <div className="space-y-1 pt-0.5">
                                  <AmrStandPresenceRow
                                    label="From"
                                    standRef={start}
                                    presenceMap={{}}
                                    loading={false}
                                    error={false}
                                    unconfigured={false}
                                    bypassRefs={emptyStandPresenceBypass}
                                    forkAction={
                                      draftDestinations && draftDestinations.length > si
                                        ? completedDepart
                                          ? 'lower'
                                          : 'lift'
                                        : undefined
                                    }
                                  />
                                  <AmrStandPresenceRow
                                    label="To"
                                    standRef={end}
                                    presenceMap={{}}
                                    loading={false}
                                    error={false}
                                    unconfigured={false}
                                    bypassRefs={emptyStandPresenceBypass}
                                    forkAction={
                                      draftDestinations && draftDestinations.length > si
                                        ? Boolean(completedArriveLower)
                                          ? 'lower'
                                          : 'lift'
                                        : undefined
                                    }
                                  />
                                </div>
                              )}
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                  {draftDestinations && tailDestRows.length > 0 ? (
                    <div className="space-y-3 border-t border-border pt-3">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={routePlanEditable ? handleTailDragEnd : undefined}
                      >
                        <SortableContext
                          items={tailDestRows.map((r) => r.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-2">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                                Remaining route
                              </p>
                            </div>

                            {routePlanEditable && sessionStatus === 'active' ? (
                              <p className="text-xs text-foreground/60">
                                A fleet segment is in progress. You can still change upcoming stops, add destinations,
                                and save the plan; use Release when the session is waiting for the next leg.
                              </p>
                            ) : null}
                            {!routePlanEditable && (awaitingContinue || sessionStatus === 'active') && !canManage ? (
                              <p className="text-xs text-foreground/60">
                                Route edits and continue require mission management permission.
                              </p>
                            ) : null}

                            {routePlanEditable ? (
                              <div className="flex w-full min-w-0 flex-col gap-2">
                                {awaitingContinue &&
                                continueNotBeforeIso &&
                                autoContinueWaitMs != null &&
                                autoContinueWaitMs > 0 ? (
                                  <p
                                    className="text-xs font-medium tabular-nums text-foreground/85"
                                    aria-live="polite"
                                  >
                                    Release in {formatRemainingMmSs(autoContinueWaitMs)}
                                    {' · '}
                                    <span className="font-normal text-foreground/65">
                                      use Release now to override
                                    </span>
                                  </p>
                                ) : null}
                                <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-3">
                                  {awaitingContinue &&
                                  canForceRelease &&
                                  showForceReleaseForMissionError ? (
                                    <button
                                      type="button"
                                      disabled={continueBusy || patchBusy}
                                      title="Bypass empty-stand check — only if the stand is clear or you accept fleet risk"
                                      className="min-h-[44px] shrink-0 rounded-lg border border-red-600/50 bg-background px-4 text-sm font-medium text-red-700 hover:bg-red-500/15 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/50"
                                      onClick={() => setForceReleaseConfirmOpen(true)}
                                    >
                                      Force release…
                                    </button>
                                  ) : null}
                                  {awaitingContinue ? (
                                    <button
                                      type="button"
                                      disabled={continueBusy || patchBusy || continueReleaseDisabledUntilStandEmpty}
                                      title={
                                        continueReleaseDisabledUntilStandEmpty
                                          ? 'Release stays off until Hyperion reports the next drop stand as empty'
                                          : undefined
                                      }
                                      className="min-h-[44px] shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35"
                                      onClick={() => void onContinue()}
                                    >
                                      {continueBusy
                                        ? 'Releasing…'
                                        : continueNotBeforeIso
                                          ? 'Release now'
                                          : 'Release Mission'}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="min-h-[44px] shrink-0 text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
                                    onClick={openAddStopModal}
                                  >
                                    Add Stop
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            {tailDestRows.map((row, i) => {
                              const si = nextSegmentIndex + i
                              const { start: legStart, end: legEnd } = segmentLegEndpoints(
                                si,
                                planPlainForLegLabels,
                                pickupPos,
                                standGroupNameById
                              )
                              return (
                                <SortableTailDestCard
                                  key={row.id}
                                  row={row}
                                  tailSlot={i + 1}
                                  segmentIndexInPlan={si}
                                  totalDestinations={draftDestinations.length}
                                  reorderable={routePlanEditable && tailDestRows.length > 1}
                                  sortableDisabled={!routePlanEditable}
                                  stopNum={si + 1}
                                  totalStops={routeTotalStops}
                                  legStart={legStart}
                                  legEnd={legEnd}
                                  warnDestinationOccupied={awaitingContinue && i === 0}
                                  highlightQueued={routeNextLegQueued && awaitingContinue && i === 0}
                                  departPutDown={draftSegFirstPutDown[si] === true}
                                  standPresence={routeStandPresenceUi}
                                  legToolbar={
                                    routePlanEditable
                                      ? i === 0
                                        ? {
                                            editLabel: 'Edit',
                                            onEdit: () => openEditStopModal(row.id),
                                            onRemove: () => {
                                              if (firstTailId) removeDraftRow(firstTailId)
                                            },
                                            canRemove: canRemoveNext,
                                          }
                                        : {
                                            editLabel: 'Edit',
                                            onEdit: () => openEditStopModal(row.id),
                                            onRemove: () => removeDraftRow(row.id),
                                            canRemove: draftDestinations.length > nextSegmentIndex + 1,
                                          }
                                      : null
                                  }
                                />
                              )
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>

                      {planEditErr ? <p className="text-xs text-red-600">{planEditErr}</p> : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {steps.length > 0 ? (
            <section className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/55">
                Stops (this stop)
              </h3>
              <ol className="space-y-2">
                {steps.map((s, idx) => (
                  <li
                    key={`${s.sequence}-${idx}`}
                    className="flex gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-foreground">
                      {s.sequence}
                    </span>
                    <span className="min-w-0 break-all font-mono text-foreground/90">{s.position}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {enterPos ? (
            <section className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/55">
                Container placement
              </h3>
              <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                Initial placement at <span className="font-mono text-foreground">{enterPos}</span>
              </p>
            </section>
          ) : null}

          <section className="mt-4 rounded-lg border border-border bg-muted/20 px-3 py-1">
            <h3 className="mb-1 px-0 pt-2 text-xs font-semibold uppercase tracking-wide text-foreground/55">Details</h3>
            <dl>
              <DetailRow label="Mission code">{missionCode ? <span className="font-mono">{missionCode}</span> : '—'}</DetailRow>
              <DetailRow label="Container">
                {containerDisplayPrimary ? <span className="font-mono">{containerDisplayPrimary}</span> : '—'}
              </DetailRow>
              <DetailRow label={robotPrimaryHeading}>
                {robotDisplayPrimary ? <span className="font-mono">{robotDisplayPrimary}</span> : '—'}
              </DetailRow>
              <DetailRow label="Final stand">{String(record.final_position ?? '—')}</DetailRow>
              <DetailRow label="Tracking">{trackingFriendly(record.worker_closed)}</DetailRow>
              <DetailRow label="Fleet complete">
                <span>{ynFlag(record.finalized)}</span>
                <span className="ml-1.5 text-[11px] text-foreground/45">when the fleet reports completion</span>
              </DetailRow>
              <DetailRow label="Stays on robot">{ynFlag(record.persistent_container)}</DetailRow>
              <DetailRow label="Removed from map">{ynFlag(record.container_out_done)}</DetailRow>
              <DetailRow label="Created">{createdAt}</DetailRow>
              <DetailRow label="Updated">{updatedAt}</DetailRow>
              <DetailRow label="Created by">{String(record.created_by_username ?? '—')}</DetailRow>
            </dl>
          </section>

          <details className="mt-4 rounded-lg border border-border/80 bg-muted/10 px-3 py-2 text-[11px] text-foreground/55">
            <summary className="cursor-pointer text-xs font-medium text-foreground/70">Technical details</summary>
            <p className="mt-2">
              Record ID: <span className="font-mono">{String(record.id ?? '')}</span>
            </p>
            {sessionId ? (
              <p className="mt-1">
                Session ID: <span className="font-mono">{sessionId}</span>
              </p>
            ) : null}
          </details>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <Link
            to={missionLogsTo}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm text-foreground hover:bg-background"
            onClick={onClose}
          >
            Mission log
          </Link>
          <button
            type="button"
            className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
      {addStopPickerOpen ? (
        <AmrStandPickerModal
          stands={standRows}
          stackOrder="aboveDialogs"
          mode={routeStopStandPickerMode}
          zoneCategories={zoneCategories}
          canOverride={canOverrideSpecial}
          allowGroups
          onClose={() => setAddStopPickerOpen(false)}
          onSelect={(externalRef, opts) => {
            if (opts.override) setOverrideSpecialLocations(true)
            const pickGid = opts.groupId?.trim()
            if (pickGid) {
              setAddStopGroupId(pickGid)
              setAddStopPosition('')
            } else {
              setAddStopGroupId(null)
              setAddStopPosition(externalRef)
            }
            setAddStopPickerOpen(false)
          }}
        />
      ) : null}

      {routeStopModal ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="amr-route-stop-title"
        >
          <div className="absolute inset-0 bg-black/50" aria-hidden />
          <div
            className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 id="amr-route-stop-title" className="text-sm font-semibold text-foreground">
                {routeStopModal.mode === 'edit' ? 'Edit stop' : 'Add stop'}
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {addStopErr ? <p className="mb-3 text-xs text-red-600">{addStopErr}</p> : null}
              <div className="grid gap-3 rounded-lg border border-border/80 p-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="col-span-full flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-xs font-medium text-foreground/65">
                    {routeStopModal.mode === 'edit' &&
                    draftDestinations &&
                    editStopSegmentIndex >= 0
                      ? `Stop ${editStopSegmentIndex + 1} of ${draftDestinations.length}`
                      : 'New stop'}
                  </span>
                </div>
                <div className="col-span-full min-w-0">
              <label htmlFor="amr-add-stop-pos" className="block text-sm text-foreground/80">
                Location (External Ref)
              </label>
              <div className="mt-1 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-4 lg:gap-y-2">
                    <div className="flex min-h-[40px] min-w-0 w-full items-stretch gap-2 lg:col-start-1 lg:row-start-1">
                  <div className="relative min-w-0 flex-1">
                    <div className="flex min-h-[40px] items-stretch overflow-hidden rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
                      <input
                        id="amr-add-stop-pos"
                        autoComplete="off"
                        spellCheck={false}
                        enterKeyHint="done"
                        readOnly={Boolean(addStopGroupId)}
                        title="Scan or pick a stand External Ref (keyboard / barcode)"
                        className="min-h-[40px] min-w-0 flex-1 border-0 bg-transparent py-2 pl-3 font-mono text-base outline-none ring-0 transition-[color,box-shadow] placeholder:text-foreground/45 focus:ring-0 md:text-sm"
                        value={
                          addStopGroupId
                            ? `Group: ${standGroupNameById[addStopGroupId] ?? addStopGroupId}`
                            : addStopPosition
                        }
                        onChange={(e) => {
                          const v = e.target.value
                          if (addStopGroupId) {
                            setAddStopGroupId(null)
                            setAddStopPosition(v)
                          } else {
                            setAddStopPosition(v)
                          }
                          setAddStopErr(null)
                        }}
                        onFocus={() => {
                          cancelAddStopSuggestClose()
                          setAddStopSuggestOpen(true)
                        }}
                        onBlur={() => {
                          if (addStopGroupId) {
                            scheduleAddStopSuggestClose()
                            return
                          }
                          const n = normalizeExternalRefFromStands(standRows, addStopPosition)
                          if (n !== addStopPosition) setAddStopPosition(n)
                          scheduleAddStopSuggestClose()
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            cancelAddStopSuggestClose()
                            setAddStopSuggestOpen(false)
                            return
                          }
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          cancelAddStopSuggestClose()
                          setAddStopSuggestOpen(false)
                          void commitRouteStopModal()
                        }}
                        placeholder="Scan or type External Ref…"
                      />
                      {addStopPosition.trim() || addStopGroupId ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          className="relative z-[15] flex shrink-0 items-center justify-center self-stretch px-1 text-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Clear location"
                          title="Clear"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setAddStopPosition('')
                            setAddStopGroupId(null)
                            cancelAddStopSuggestClose()
                            setAddStopSuggestOpen(false)
                          }}
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="flex min-h-[40px] w-10 shrink-0 items-center justify-center border-l border-border/70 bg-muted/20 text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:relative focus-visible:z-[15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Show stand list"
                        aria-expanded={addStopSuggestOpen}
                        title="Show stand list"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          cancelAddStopSuggestClose()
                          setAddStopSuggestOpen((o) => !o)
                        }}
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {addStopSuggestOpen ? (
                      addStopSuggestedStands.length > 0 ? (
                        <ul
                          className="absolute left-0 right-0 top-full z-[70] mt-0.5 max-h-48 overflow-y-auto rounded-lg border border-border bg-card py-1 text-card-foreground shadow-md"
                          role="listbox"
                        >
                          {addStopSuggestedStands.map((s) => (
                            <li key={s.id} role="option">
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left font-mono text-sm font-medium hover:bg-muted"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setAddStopGroupId(null)
                                  setAddStopPosition(s.external_ref)
                                  cancelAddStopSuggestClose()
                                  setAddStopSuggestOpen(false)
                                  setAddStopErr(null)
                                }}
                              >
                                {s.external_ref}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : standRows.length > 0 ? (
                        <div className="absolute left-0 right-0 top-full z-[70] mt-0.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground/70 shadow-md">
                          No matching stands
                        </div>
                      ) : null
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="flex h-10 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Choose location on map"
                    title="Choose location"
                    onClick={() => {
                      cancelAddStopSuggestClose()
                      setAddStopSuggestOpen(false)
                      setAddStopPickerOpen(true)
                    }}
                  >
                    <LocationPinIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex flex-col gap-2 lg:col-start-2 lg:row-start-1 lg:max-w-[min(100%,20rem)] lg:shrink-0">
                  <div className="flex items-center gap-3 text-foreground/70">
                    <ToggleSwitch
                      checked={showRouteModalPutDownToggle ? routeStopPutDown : true}
                      disabled={!showRouteModalPutDownToggle}
                      onCheckedChange={(on) => {
                        setRouteStopPutDown(on)
                        setAddStopErr(null)
                      }}
                      aria-label={
                        showRouteModalPutDownToggle
                          ? routeStopPutDown
                            ? 'Drop Pallet'
                            : 'Pickup Pallet'
                          : 'Drop Pallet'
                      }
                      title={
                        showRouteModalPutDownToggle
                          ? undefined
                          : 'Final stop is always drop'
                      }
                      size="sm"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      {showRouteModalPutDownToggle
                        ? routeStopPutDown
                          ? 'Drop Pallet'
                          : 'Pickup Pallet'
                        : 'Drop Pallet'}
                    </span>
                  </div>
                  {showRouteModalReleaseControls ? (
                    <>
                      <div className="flex items-center gap-3">
                        <ToggleSwitch
                          checked={addStopContinueMode === 'auto'}
                          onCheckedChange={(on) => {
                            setAddStopContinueMode(on ? 'auto' : 'manual')
                            setAddStopErr(null)
                          }}
                          aria-label={addStopContinueMode === 'auto' ? 'Auto Release' : 'Manual Release'}
                          size="sm"
                          className="shrink-0"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          {addStopContinueMode === 'auto' ? 'Auto Release' : 'Manual Release'}
                        </span>
                      </div>
                      {addStopContinueMode === 'auto' ? (
                        <label
                          htmlFor="amr-add-stop-continue-secs"
                          className="flex flex-wrap items-center gap-2 pl-1 text-sm text-foreground/85 lg:col-start-2 lg:row-start-2 lg:max-w-[min(100%,20rem)]"
                        >
                          <span className="text-foreground/70">After</span>
                          <input
                            id="amr-add-stop-continue-secs"
                            type="number"
                            min={0}
                            max={86400}
                            inputMode="numeric"
                            className="w-[5.5rem] rounded-md border border-border bg-background px-2 py-1 font-mono text-sm"
                            value={addStopAutoSeconds}
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              setAddStopAutoSeconds(Number.isFinite(n) ? n : 0)
                              setAddStopErr(null)
                            }}
                          />
                          <span>s</span>
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              {(() => {
                if (addStopGroupId && !addStopPosition.trim()) return null
                const status = legRestrictionStatus(
                  standRows,
                  addStopPosition,
                  showRouteModalPutDownToggle ? routeStopPutDown : true
                )
                if (!status.violated) return null
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200">
                    <span className="leading-snug">{status.message}</span>
                    {canOverrideSpecial ? (
                      <label className="ml-auto flex cursor-pointer select-none items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border"
                          checked={overrideSpecialLocations}
                          onChange={(e) => setOverrideSpecialLocations(e.target.checked)}
                        />
                        <span>Override restriction</span>
                      </label>
                    ) : null}
                  </div>
                )
              })()}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
              <button
                type="button"
                className="min-h-[44px] rounded-lg border border-border px-4 text-sm text-foreground hover:bg-muted"
                onClick={closeRouteStopModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                onClick={() => void commitRouteStopModal()}
              >
                {routeStopModal.mode === 'edit' ? 'Save' : 'Add to route'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
