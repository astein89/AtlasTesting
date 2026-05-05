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
  continueAmrMultistopSession,
  getAmrMultistopSession,
  getAmrStands,
  patchAmrMultistopSession,
} from '@/api/amr'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import {
  AmrStandPickerModal,
  LocationPinIcon,
  type AmrStandPickerRow,
} from '@/components/amr/AmrStandPickerModal'
import { amrPath } from '@/lib/appPaths'
import { friendlyMultistopSessionStatus } from '@/utils/amrMultistopDisplay'
import { formatRemainingMmSs, remainingMsUntilIso } from '@/utils/amrContinueCountdown'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAuthStore } from '@/store/authStore'

export type AmrMissionRecordRow = Record<string, unknown>

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
}

type DraftDest = MultistopPlanDest & { id: string }

/** Payload rows stored / PATCHed — fleet missionData stays AUTO / zero wait; app fields for release timing. */
function draftToPlan(rows: DraftDest[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const position = row.position.trim()
    const mode = row.continueMode === 'auto' ? 'auto' : 'manual'
    const base: Record<string, unknown> = {
      position,
      passStrategy: 'AUTO',
      waitingMillis: 0,
      continueMode: mode,
    }
    if (mode === 'auto') {
      const sec = Math.max(1, Math.min(Math.floor(row.autoContinueSeconds ?? 0), 86400))
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
      if (!position) return null
      const cm = row.continueMode === 'auto' ? 'auto' : 'manual'
      const n =
        typeof row.autoContinueSeconds === 'number'
          ? row.autoContinueSeconds
          : Number(row.autoContinueSeconds)
      const entry: MultistopPlanDest = { position, continueMode: cm }
      if (cm === 'auto' && Number.isFinite(n) && n >= 1) {
        entry.autoContinueSeconds = Math.min(Math.floor(n), 86400)
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
    if (pcm === 'auto' && Number.isFinite(pn) && pn >= 1) {
      return { continueMode: 'auto', autoContinueSeconds: Math.min(Math.floor(pn), 86400) }
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
  if (pc.continueMode === 'auto' && typeof pc.autoContinueSeconds === 'number' && pc.autoContinueSeconds >= 1) {
    return `Before first leg: Auto-release after ${pc.autoContinueSeconds}s`
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

/** Start/end nodes for plan segment index `si` (0-based). */
function segmentLegEndpoints(
  si: number,
  plan: MultistopPlanDest[] | null | undefined,
  pickup: string | null
): { start: string; end: string } {
  const p = plan ?? []
  const end = p[si]?.position?.trim() || '—'
  const start = si === 0 ? pickup?.trim() || '—' : p[si - 1]?.position?.trim() || '—'
  return { start, end }
}

function validateMultistopPlan(
  plan: Array<{
    position: string
    continueMode?: 'manual' | 'auto'
    autoContinueSeconds?: number
  }>
): string | null {
  for (let i = 0; i < plan.length; i++) {
    if (!plan[i].position.trim()) return `Destination ${i + 1} needs an External Ref.`
  }
  for (let i = 0; i < plan.length - 1; i++) {
    const r = plan[i]
    if (r.continueMode === 'auto' && (r.autoContinueSeconds ?? 0) < 1) {
      return `Destination ${i + 1}: Auto Release needs at least 1 second.`
    }
  }
  return null
}

function SortableTailDestCard({
  row,
  tailSlot,
  canRemove,
  onPatch,
  onRemove,
  readOnly,
  reorderable,
  stopNum,
  totalStops,
  legStart,
  legEnd,
  legToolbar,
  standLocation,
  sortableDisabled,
  segmentIndexInPlan,
  totalDestinations,
}: {
  row: DraftDest
  /** 1 = next fleet leg (first in tail); drives highlight vs later stops. */
  tailSlot: number
  canRemove: boolean
  onPatch: (id: string, patch: Partial<MultistopPlanDest>) => void
  onRemove: (id: string) => void
  /** When true, show summary only (used for the upcoming leg until the user clicks Edit). */
  readOnly?: boolean
  /** When false, drag handle is hidden (nothing to reorder). */
  reorderable?: boolean
  stopNum: number
  totalStops: number
  legStart: string
  legEnd: string
  /** Edit / Remove in the heading (next leg + later stops when collapsed). */
  legToolbar?: {
    editLabel: string
    onEdit: () => void
    onRemove: () => void
    canRemove: boolean
  } | null
  /** Same External Ref UX as new missions (suggest + map picker). */
  standLocation?: {
    stands: AmrStandPickerRow[]
    suggestOpen: boolean
    suggestedStands: AmrStandPickerRow[]
    onPositionFocus: () => void
    onPositionBlur: () => void
    onCloseSuggest: () => void
    onOpenPicker: () => void
  } | null
  /** When true, card stays in the sortable list but cannot be dragged (view-only route). */
  sortableDisabled?: boolean
  /** 0-based index in full destination list; release timing applies before next leg except final stop. */
  segmentIndexInPlan?: number
  totalDestinations?: number
}) {
  const isNext = tailSlot === 1
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
          <p className="text-xs font-semibold tabular-nums text-foreground">
            Stop {stopNum} of {totalStops}
          </p>
          <p className="mt-1.5 break-all font-mono text-sm leading-normal text-foreground/85">
            <span className="text-foreground/50">Start </span>
            {legStart}
            <span className="mx-1.5 text-foreground/30">→</span>
            <span className="text-foreground/50">End </span>
            {legEnd}
          </p>
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
      className={`rounded-lg border p-3 ${
        showGrip ? 'grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 items-start' : 'flex flex-col gap-2'
      } ${
        isNext
          ? 'border-primary/45 bg-primary/8 ring-1 ring-primary/20'
          : 'border-border/80 bg-muted/15'
      } ${isDragging ? 'z-[5] opacity-95 shadow-md' : ''}`}
    >
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
        {readOnly &&
        typeof segmentIndexInPlan === 'number' &&
        typeof totalDestinations === 'number' ? (
          <p className="mt-2 text-xs text-foreground/65">
            {formatReleaseAfterStopReadOnly(row, segmentIndexInPlan, totalDestinations)}
          </p>
        ) : null}
        {readOnly ? null : (
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              {isNext ? (
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary">Next fleet stop</span>
                </div>
              ) : null}
              <label className="block text-xs font-medium text-foreground/70">
                <span className="text-foreground/80">Location (External Ref)</span>
                {standLocation ? (
                  <div className="mt-1 flex min-h-[40px] items-stretch gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id={`amr-detail-tail-pos-${row.id}`}
                        autoComplete="off"
                        spellCheck={false}
                        enterKeyHint="done"
                        title="Scan or pick a stand External Ref (keyboard / barcode)"
                        className={`min-h-[40px] w-full rounded-lg border border-border bg-background py-2 pl-3 font-mono text-sm ${row.position.trim() ? 'pr-10' : 'pr-3'}`}
                        value={row.position}
                        onChange={(e) => onPatch(row.id, { position: e.target.value })}
                        onFocus={standLocation.onPositionFocus}
                        onBlur={standLocation.onPositionBlur}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            standLocation.onCloseSuggest()
                            return
                          }
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          standLocation.onCloseSuggest()
                        }}
                        placeholder="Scan or type External Ref…"
                      />
                      {row.position.trim() ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute right-1.5 top-1/2 z-[15] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Clear location"
                          title="Clear"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            onPatch(row.id, { position: '' })
                            standLocation.onCloseSuggest()
                          }}
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : null}
                      {standLocation.suggestOpen ? (
                        standLocation.suggestedStands.length > 0 ? (
                          <ul
                            className="absolute left-0 right-0 top-full z-[60] mt-0.5 max-h-48 overflow-y-auto rounded-lg border border-border bg-card py-1 text-card-foreground shadow-md"
                            role="listbox"
                          >
                            {standLocation.suggestedStands.map((s) => (
                              <li key={s.id} role="option">
                                <button
                                  type="button"
                                  className="w-full px-3 py-2 text-left font-mono text-sm font-medium hover:bg-muted"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    onPatch(row.id, { position: s.external_ref })
                                    standLocation.onCloseSuggest()
                                  }}
                                >
                                  {s.external_ref}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : standLocation.stands.length > 0 ? (
                          <div className="absolute left-0 right-0 top-full z-[60] mt-0.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground/70 shadow-md">
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
                        standLocation.onCloseSuggest()
                        standLocation.onOpenPicker()
                      }}
                    >
                      <LocationPinIcon className="h-5 w-5" />
                    </button>
                  </div>
                ) : (
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                    value={row.position}
                    onChange={(e) => onPatch(row.id, { position: e.target.value })}
                    placeholder="Stand / node code"
                  />
                )}
              </label>
            </div>
            {legToolbar ? null : (
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <button
                  type="button"
                  disabled={!canRemove}
                  title={canRemove ? 'Remove this destination' : 'Keep at least one remaining stop'}
                  className="rounded-md border border-red-500/30 bg-background px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                  onClick={() => onRemove(row.id)}
                >
                  Remove
                </button>
              </div>
            )}
            {typeof segmentIndexInPlan === 'number' &&
            typeof totalDestinations === 'number' &&
            segmentIndexInPlan < totalDestinations - 1 ? (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <ToggleSwitch
                    checked={row.continueMode === 'auto'}
                    onCheckedChange={(on) =>
                      onPatch(row.id, {
                        continueMode: on ? 'auto' : 'manual',
                        autoContinueSeconds: row.autoContinueSeconds ?? 0,
                      })
                    }
                    aria-label={
                      row.continueMode === 'auto' ? 'Auto Release' : 'Manual Release'
                    }
                    size="sm"
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1 text-xs">
                    {row.continueMode === 'auto' ? 'Auto Release' : 'Manual Release'}
                  </span>
                </div>
                {row.continueMode === 'auto' ? (
                  <label className="flex flex-wrap items-center gap-2 pl-1 text-xs text-foreground/85">
                    <span className="text-foreground/70">After</span>
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      inputMode="numeric"
                      className="w-[5rem] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                      value={row.autoContinueSeconds ?? 0}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        onPatch(row.id, {
                          continueMode: 'auto',
                          autoContinueSeconds: Number.isFinite(n) ? n : 0,
                        })
                      }}
                    />
                    <span>s</span>
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
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
  const [msRefresh, setMsRefresh] = useState(0)
  const [msData, setMsData] = useState<{
    session: Record<string, unknown>
    records: Record<string, unknown>[]
  } | null>(null)
  const [msLoading, setMsLoading] = useState(false)
  const [msErr, setMsErr] = useState<string | null>(null)
  const [continueBusy, setContinueBusy] = useState(false)
  const [patchBusy, setPatchBusy] = useState(false)
  const [draftDestinations, setDraftDestinations] = useState<DraftDest[] | null>(null)
  const [savedPlanSnapshot, setSavedPlanSnapshot] = useState('')
  const [planEditErr, setPlanEditErr] = useState<string | null>(null)
  const [editingNextLeg, setEditingNextLeg] = useState(false)
  /** Which later tail row (not index 0) has the location editor expanded; null = all collapsed. */
  const [editingTailRowId, setEditingTailRowId] = useState<string | null>(null)

  const [standRows, setStandRows] = useState<AmrStandPickerRow[]>([])
  const [suggestRowId, setSuggestRowId] = useState<string | null>(null)
  const [pickerRowId, setPickerRowId] = useState<string | null>(null)
  const suggestCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [addStopModalOpen, setAddStopModalOpen] = useState(false)
  const [addStopPosition, setAddStopPosition] = useState('')
  const [addStopErr, setAddStopErr] = useState<string | null>(null)
  const [addStopSuggestOpen, setAddStopSuggestOpen] = useState(false)
  const [addStopPickerOpen, setAddStopPickerOpen] = useState(false)
  const addStopSuggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Avoid msLoading flicker when parent polling bumps `record.updated_at` but session id is unchanged. */
  const prevFetchedMultistopSessionIdRef = useRef<string | null>(null)

  const cancelSuggestClose = useCallback(() => {
    if (suggestCloseTimerRef.current) {
      clearTimeout(suggestCloseTimerRef.current)
      suggestCloseTimerRef.current = null
    }
  }, [])

  const scheduleSuggestClose = useCallback(() => {
    cancelSuggestClose()
    suggestCloseTimerRef.current = setTimeout(() => setSuggestRowId(null), 180)
  }, [cancelSuggestClose])

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
      if (pickerRowId || addStopPickerOpen) {
        e.preventDefault()
        setPickerRowId(null)
        setAddStopPickerOpen(false)
        return
      }
      if (addStopModalOpen) {
        e.preventDefault()
        cancelAddStopSuggestClose()
        setAddStopSuggestOpen(false)
        setAddStopModalOpen(false)
        setAddStopErr(null)
        return
      }
      if (suggestRowId) {
        e.preventDefault()
        cancelSuggestClose()
        setSuggestRowId(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    record,
    onClose,
    pickerRowId,
    addStopPickerOpen,
    addStopModalOpen,
    suggestRowId,
    cancelSuggestClose,
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
        }))
      )
    )
  }, [])

  useEffect(() => {
    setSuggestRowId(null)
    setPickerRowId(null)
    cancelSuggestClose()
    cancelAddStopSuggestClose()
    setAddStopSuggestOpen(false)
    setAddStopPickerOpen(false)
    setAddStopModalOpen(false)
    setAddStopErr(null)
    setEditingTailRowId(null)
  }, [sessionId, cancelSuggestClose, cancelAddStopSuggestClose])

  useEffect(() => {
    if (!sessionId) {
      prevFetchedMultistopSessionIdRef.current = null
      setMsData(null)
      setMsErr(null)
      setDraftDestinations(null)
      setSavedPlanSnapshot('')
      setEditingTailRowId(null)
      return
    }
    const sessionIdChanged = prevFetchedMultistopSessionIdRef.current !== sessionId
    prevFetchedMultistopSessionIdRef.current = sessionId
    if (sessionIdChanged) {
      setMsLoading(true)
    }
    setMsErr(null)
    let cancelled = false
    void getAmrMultistopSession(sessionId)
      .then((d) => {
        if (cancelled) return
        setMsData(d)
        const parsed = parsePlanDestinations(d.session?.plan_json)
        if (parsed) {
          const draft = planToDraft(parsed)
          setDraftDestinations(draft)
          setSavedPlanSnapshot(JSON.stringify(draftToPlan(draft)))
        } else {
          setDraftDestinations(null)
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

  useEffect(() => {
    setEditingNextLeg(false)
    setEditingTailRowId(null)
  }, [nextSegmentIndex])

  /** Resolved plan for leg labels: prefer live draft, else session snapshot. */
  const planPlainForLegLabels = useMemo((): MultistopPlanDest[] | null => {
    if (draftDestinations?.length) {
      return draftDestinations.map((r) => ({ position: r.position }))
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

  const hasPlanChanges = useMemo(() => {
    if (!draftDestinations) return false
    return JSON.stringify(draftToPlan(draftDestinations)) !== savedPlanSnapshot
  }, [draftDestinations, savedPlanSnapshot])

  const patchDraftRow = useCallback((id: string, patch: Partial<MultistopPlanDest>) => {
    setDraftDestinations((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev))
  }, [])

  const removeDraftRow = useCallback(
    (id: string) => {
      setEditingTailRowId((cur) => (cur === id ? null : cur))
      setDraftDestinations((prev) => {
        if (!prev) return prev
        if (prev.length <= nextSegmentIndex + 1) return prev
        return prev.filter((r) => r.id !== id)
      })
    },
    [nextSegmentIndex]
  )

  const openAddStopModal = useCallback(() => {
    setAddStopErr(null)
    setAddStopPosition('')
    setAddStopSuggestOpen(false)
    setAddStopPickerOpen(false)
    cancelAddStopSuggestClose()
    setAddStopModalOpen(true)
  }, [cancelAddStopSuggestClose])

  const closeAddStopModal = useCallback(() => {
    setAddStopModalOpen(false)
    setAddStopErr(null)
    setAddStopSuggestOpen(false)
    setAddStopPickerOpen(false)
    cancelAddStopSuggestClose()
  }, [cancelAddStopSuggestClose])

  const persistPlanFromDraftRows = useCallback(async (rows: DraftDest[]): Promise<boolean> => {
    if (!sessionId) return false
    const plan = draftToPlan(rows)
    const err = validateMultistopPlan(rows)
    if (err) {
      setPlanEditErr(err)
      return false
    }
    setPlanEditErr(null)
    setPatchBusy(true)
    try {
      await patchAmrMultistopSession(sessionId, { destinations: plan })
      setSavedPlanSnapshot(JSON.stringify(plan))
      return true
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setPlanEditErr(ax?.response?.data?.error ?? 'Save failed')
      return false
    } finally {
      setPatchBusy(false)
    }
  }, [sessionId])

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
        const nextRows = [...head, ...arrayMove(tail, oldIdx, newIdx)]
        void persistPlanFromDraftRows(nextRows)
        return nextRows
      })
    },
    [nextSegmentIndex, persistPlanFromDraftRows]
  )

  const commitAddStopFromModal = useCallback(() => {
    const pos = normalizeExternalRefFromStands(standRows, addStopPosition)
    if (!pos.trim()) {
      setAddStopErr('Enter an External Ref for this stop.')
      return
    }
    const id = uuidv4()
    closeAddStopModal()
    setDraftDestinations((prev) => {
      if (!prev) return prev
      const newRows = [
        ...prev,
        { id, position: pos, continueMode: 'manual' as const, autoContinueSeconds: 0 },
      ]
      queueMicrotask(() => {
        void persistPlanFromDraftRows(newRows)
      })
      return newRows
    })
  }, [addStopPosition, standRows, closeAddStopModal, persistPlanFromDraftRows])

  const suggestedStands = useMemo(() => {
    if (!suggestRowId || !draftDestinations) return []
    const d = draftDestinations.find((r) => r.id === suggestRowId)
    if (!d) return []
    return filterStandsForSuggest(standRows, d.position)
  }, [suggestRowId, draftDestinations, standRows])

  const addStopSuggestedStands = useMemo(() => {
    if (!addStopModalOpen) return []
    return filterStandsForSuggest(standRows, addStopPosition)
  }, [addStopModalOpen, standRows, addStopPosition])

  const sessionStatus = msData?.session?.status != null ? String(msData.session.status) : null
  const awaitingContinue = sessionStatus === 'awaiting_continue'
  const continueNotBeforeRaw = msData?.session?.continue_not_before
  const continueNotBeforeIso =
    typeof continueNotBeforeRaw === 'string' && continueNotBeforeRaw.trim()
      ? continueNotBeforeRaw.trim()
      : null
  const [, setCountdownTick] = useState(0)
  useEffect(() => {
    if (!awaitingContinue || !continueNotBeforeIso) return
    const t = setInterval(() => setCountdownTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [awaitingContinue, continueNotBeforeIso])

  if (!record) return null

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

  /** Continue / patch plan / reorder — only while waiting; show remaining route read-only while segment is active. */
  const routeActionsEnabled = canManage && awaitingContinue
  const pickupPos =
    msData?.session?.pickup_position != null ? String(msData.session.pickup_position) : null
  const pickupContinueHint = useMemo(
    () => parsePickupContinueFromPlanJson(msData?.session?.plan_json),
    [msData?.session?.plan_json]
  )

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
    setPlanEditErr(null)
    try {
      if (hasPlanChanges) {
        const ok = await persistPlanToServer()
        if (!ok) return
      }
      await continueAmrMultistopSession(sessionId)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setMsErr(ax?.response?.data?.error ?? 'Continue failed')
    } finally {
      setContinueBusy(false)
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {sessionId ? (
            <section className="space-y-3 rounded-lg border border-border bg-card px-3 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/55">
                {chainMultistopRoute ? 'Multi-stop route' : 'Route'}
              </h3>
              {msLoading ? <p className="text-sm text-foreground/60">Loading session…</p> : null}
              {msErr ? <p className="text-sm text-red-600">{msErr}</p> : null}
              {!msLoading && msData ? (
                <>
                  {pickupPos ? (
                    <div className="space-y-1">
                      <p className="text-sm">
                        Pickup: <span className="font-mono">{pickupPos}</span>
                      </p>
                      {pickupContinueHint ? (
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
                          const { start, end } = segmentLegEndpoints(si, planPlainForLegLabels, pickupPos)
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
                              <p className="break-all font-mono text-sm leading-normal text-foreground/85">
                                <span className="text-foreground/50">Start </span>
                                {start}
                                <span className="mx-1.5 text-foreground/30">→</span>
                                <span className="text-foreground/50">End </span>
                                {end}
                              </p>
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
                        onDragEnd={routeActionsEnabled ? handleTailDragEnd : undefined}
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

                            {!routeActionsEnabled && sessionStatus === 'active' ? (
                              <p className="text-xs text-foreground/60">
                                This stop is running. Continue, add stops, and route edits are available when the
                                fleet finishes this stop and the session is waiting for the next step.
                              </p>
                            ) : null}
                            {!routeActionsEnabled && awaitingContinue && !canManage ? (
                              <p className="text-xs text-foreground/60">
                                Continue and route edits require mission permission.
                              </p>
                            ) : null}

                            {routeActionsEnabled ? (
                              <div className="flex w-full min-w-0 flex-col gap-2">
                                {continueNotBeforeIso ? (
                                  <p
                                    className="text-xs font-medium tabular-nums text-foreground/85"
                                    aria-live="polite"
                                  >
                                    Auto-continues in{' '}
                                    {formatRemainingMmSs(remainingMsUntilIso(continueNotBeforeIso) ?? 0)}
                                    {' · '}
                                    <span className="font-normal text-foreground/65">
                                      use Continue now to override
                                    </span>
                                  </p>
                                ) : null}
                                <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
                                <button
                                  type="button"
                                  disabled={continueBusy || patchBusy}
                                  className="min-h-[44px] shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35"
                                  onClick={() => void onContinue()}
                                >
                                  {continueBusy
                                    ? 'Continuing…'
                                    : continueNotBeforeIso
                                      ? 'Continue now'
                                      : 'Continue to next stop'}
                                </button>
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
                                pickupPos
                              )
                              return (
                                <SortableTailDestCard
                                  key={row.id}
                                  row={row}
                                  tailSlot={i + 1}
                                  segmentIndexInPlan={si}
                                  totalDestinations={draftDestinations.length}
                                  canRemove={draftDestinations.length > nextSegmentIndex + 1}
                                  onPatch={patchDraftRow}
                                  onRemove={removeDraftRow}
                                  readOnly={
                                    !routeActionsEnabled
                                      ? true
                                      : i === 0
                                        ? !editingNextLeg
                                        : editingTailRowId !== row.id
                                  }
                                  reorderable={routeActionsEnabled && tailDestRows.length > 1}
                                  sortableDisabled={!routeActionsEnabled}
                                  stopNum={si + 1}
                                  totalStops={routeTotalStops}
                                  legStart={legStart}
                                  legEnd={legEnd}
                                  legToolbar={
                                    routeActionsEnabled
                                      ? i === 0
                                        ? {
                                            editLabel: editingNextLeg ? 'Done editing' : 'Edit',
                                            onEdit: () => {
                                              setEditingTailRowId(null)
                                              setEditingNextLeg((v) => !v)
                                            },
                                            onRemove: () => {
                                              if (firstTailId) removeDraftRow(firstTailId)
                                            },
                                            canRemove: canRemoveNext,
                                          }
                                        : {
                                            editLabel:
                                              editingTailRowId === row.id ? 'Done editing' : 'Edit',
                                            onEdit: () => {
                                              setEditingNextLeg(false)
                                              setEditingTailRowId((cur) =>
                                                cur === row.id ? null : row.id
                                              )
                                            },
                                            onRemove: () => removeDraftRow(row.id),
                                            canRemove: draftDestinations.length > nextSegmentIndex + 1,
                                          }
                                      : null
                                  }
                                  standLocation={
                                    routeActionsEnabled
                                      ? {
                                          stands: standRows,
                                          suggestOpen: suggestRowId === row.id,
                                          suggestedStands,
                                          onPositionFocus: () => {
                                            cancelSuggestClose()
                                            setSuggestRowId(row.id)
                                          },
                                          onPositionBlur: () => {
                                            const n = normalizeExternalRefFromStands(standRows, row.position)
                                            if (n !== row.position) patchDraftRow(row.id, { position: n })
                                            scheduleSuggestClose()
                                          },
                                          onCloseSuggest: () => {
                                            cancelSuggestClose()
                                            setSuggestRowId(null)
                                          },
                                          onOpenPicker: () => {
                                            cancelSuggestClose()
                                            setSuggestRowId(null)
                                            setPickerRowId(row.id)
                                          },
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
            to={amrPath('logs')}
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
      {pickerRowId || addStopPickerOpen ? (
        <AmrStandPickerModal
          stands={standRows}
          stackOrder="aboveDialogs"
          onClose={() => {
            setPickerRowId(null)
            setAddStopPickerOpen(false)
          }}
          onSelect={(externalRef) => {
            if (addStopPickerOpen) {
              setAddStopPosition(externalRef)
              setAddStopPickerOpen(false)
              return
            }
            if (pickerRowId) {
              patchDraftRow(pickerRowId, { position: externalRef })
              setPickerRowId(null)
            }
          }}
        />
      ) : null}

      {addStopModalOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="amr-add-stop-title"
        >
          <div className="absolute inset-0 bg-black/50" aria-hidden />
          <div
            className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 id="amr-add-stop-title" className="text-sm font-semibold text-foreground">
                Add stop
              </h2>
              <p className="mt-1 text-xs text-foreground/65">
                Enter details, then add to the remaining route. The plan is saved automatically.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {addStopErr ? <p className="mb-3 text-xs text-red-600">{addStopErr}</p> : null}
              <label className="block text-xs font-medium text-foreground/70">
                <span className="text-foreground/80">Location (External Ref)</span>
                <div className="mt-1 flex min-h-[40px] items-stretch gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input
                      id="amr-add-stop-pos"
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      title="Scan or pick a stand External Ref (keyboard / barcode)"
                      className={`min-h-[40px] w-full rounded-lg border border-border bg-background py-2 pl-3 font-mono text-sm ${addStopPosition.trim() ? 'pr-10' : 'pr-3'}`}
                      value={addStopPosition}
                      onChange={(e) => {
                        setAddStopPosition(e.target.value)
                        setAddStopErr(null)
                      }}
                      onFocus={() => {
                        cancelAddStopSuggestClose()
                        setAddStopSuggestOpen(true)
                      }}
                      onBlur={() => {
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
                        commitAddStopFromModal()
                      }}
                      placeholder="Scan or type External Ref…"
                    />
                    {addStopPosition.trim() ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-1.5 top-1/2 z-[15] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Clear location"
                        title="Clear"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setAddStopPosition('')
                          cancelAddStopSuggestClose()
                          setAddStopSuggestOpen(false)
                        }}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : null}
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
              </label>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
              <button
                type="button"
                className="min-h-[44px] rounded-lg border border-border px-4 text-sm text-foreground hover:bg-muted"
                onClick={closeAddStopModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                onClick={() => void commitAddStopFromModal()}
              >
                Add to route
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
