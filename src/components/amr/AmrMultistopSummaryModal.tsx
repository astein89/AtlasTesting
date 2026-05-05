import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { continueAmrMultistopSession, getAmrMultistopSession } from '@/api/amr'
import { AmrAutoContinueCountdown } from '@/components/amr/AmrAutoContinueCountdown'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'
import {
  friendlyMultistopSessionStatus,
  headRecordForMissionDetail,
  isChainedMultistopGroup,
  type GroupedMissionMultistop,
} from '@/utils/amrMultistopDisplay'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAuthStore } from '@/store/authStore'

type MissionRecordRow = Record<string, unknown>

function parsePayload(record: MissionRecordRow): Record<string, unknown> | null {
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

function unlockRobotIdFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const submit = payload.submit as { unlockRobotId?: unknown } | undefined
  const u = submit?.unlockRobotId
  return typeof u === 'string' && u.trim() ? u.trim() : null
}

function msStepIndex(r: Record<string, unknown>): number {
  const raw = r.multistop_step_index
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

type PlanDest = {
  position: string
  continueMode?: 'manual' | 'auto'
  autoContinueSeconds?: number
}

type ParsedSessionPlan = {
  destinations: PlanDest[]
  pickupContinue?: { continueMode: 'manual' | 'auto'; autoContinueSeconds?: number }
}

function parseSessionPlan(planJson: unknown): ParsedSessionPlan | null {
  if (typeof planJson !== 'string' || !planJson.trim()) return null
  try {
    const o = JSON.parse(planJson) as { destinations?: unknown; pickupContinue?: unknown }
    if (!Array.isArray(o.destinations)) return null
    const out: PlanDest[] = []
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
      const entry: PlanDest = { position, continueMode: cm }
      if (cm === 'auto' && Number.isFinite(n) && n >= 1) {
        entry.autoContinueSeconds = Math.min(Math.floor(n), 86400)
      }
      out.push(entry)
    }
    if (out.length === 0) return null
    let pickupContinue: ParsedSessionPlan['pickupContinue']
    const pc = o.pickupContinue
    if (pc && typeof pc === 'object') {
      const pcr = pc as Record<string, unknown>
      const pcm = pcr.continueMode === 'auto' ? 'auto' : 'manual'
      const pn =
        typeof pcr.autoContinueSeconds === 'number'
          ? pcr.autoContinueSeconds
          : Number(pcr.autoContinueSeconds)
      if (pcm === 'auto' && Number.isFinite(pn) && pn >= 1) {
        pickupContinue = { continueMode: 'auto', autoContinueSeconds: Math.min(Math.floor(pn), 86400) }
      } else {
        pickupContinue = { continueMode: 'manual' }
      }
    }
    return pickupContinue ? { destinations: out, pickupContinue } : { destinations: out }
  } catch {
    return null
  }
}

function formatPickupRelease(pc: { continueMode: 'manual' | 'auto'; autoContinueSeconds?: number }): string {
  if (pc.continueMode === 'auto' && typeof pc.autoContinueSeconds === 'number' && pc.autoContinueSeconds >= 1) {
    return `Before first leg: Auto-release after ${pc.autoContinueSeconds}s`
  }
  return 'Before first leg: Manual release'
}

/** Release timing after arriving at destination index `i`, before the next segment (plan semantics). */
function formatReleaseAfterDestination(dest: PlanDest | undefined, isLastStop: boolean): string {
  if (isLastStop) return 'After arrival: Manual (final stop)'
  if (!dest) return 'After arrival: Manual release'
  const mode = dest.continueMode === 'auto' ? 'auto' : 'manual'
  if (mode === 'auto') {
    const s = dest.autoContinueSeconds
    if (typeof s === 'number' && Number.isFinite(s) && s >= 1) {
      return `After arrival: Auto-release after ${s}s`
    }
  }
  return 'After arrival: Manual release'
}

function segmentLegEndpoints(
  si: number,
  plan: PlanDest[] | null | undefined,
  pickup: string | null
): { start: string; end: string } {
  const p = plan ?? []
  const end = p[si]?.position?.trim() || '—'
  const start = si === 0 ? pickup?.trim() || '—' : p[si - 1]?.position?.trim() || '—'
  return { start, end }
}

type LegBucket = 'completed' | 'current' | 'next_continue' | 'upcoming' | 'done'

function segmentBucket(i: number, st: string, nextSeg: number, _total: number): LegBucket {
  if (st === 'completed') return 'done'
  if (st === 'failed') {
    if (i < nextSeg) return 'completed'
    return 'upcoming'
  }
  if (st === 'awaiting_continue') {
    if (i < nextSeg) return 'completed'
    if (i === nextSeg) return 'next_continue'
    return 'upcoming'
  }
  if (st === 'active') {
    if (nextSeg <= 0) return 'upcoming'
    if (i < nextSeg - 1) return 'completed'
    if (i === nextSeg - 1) return 'current'
    return 'upcoming'
  }
  return 'upcoming'
}

function bucketLabel(b: LegBucket): string {
  switch (b) {
    case 'completed':
      return 'Completed'
    case 'current':
      return 'In progress'
    case 'next_continue':
      return 'Next — Continue'
    case 'upcoming':
      return 'Upcoming'
    case 'done':
      return 'Completed'
    default:
      return ''
  }
}

function bucketRowClass(b: LegBucket): string {
  switch (b) {
    case 'current':
      return 'border-primary/40 bg-primary/[0.06]'
    case 'next_continue':
      return 'border-amber-500/45 bg-amber-500/[0.08]'
    case 'completed':
    case 'done':
      return 'border-border/80 bg-muted/25'
    default:
      return 'border-border/70 bg-card'
  }
}

export type AmrMultistopSummaryModalProps = {
  group: GroupedMissionMultistop | null
  onClose: () => void
  onSessionUpdated?: () => void
  /** Opens the full mission editor ({@link AmrMissionDetailModal}). */
  onOpenFullMission: (headRecord: Record<string, unknown>) => void
}

export function AmrMultistopSummaryModal({
  group,
  onClose,
  onSessionUpdated,
  onOpenFullMission,
}: AmrMultistopSummaryModalProps) {
  const canManage = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const [msRefresh, setMsRefresh] = useState(0)
  const [msData, setMsData] = useState<{ session: Record<string, unknown>; records: MissionRecordRow[] } | null>(null)
  const [msLoading, setMsLoading] = useState(false)
  const [msErr, setMsErr] = useState<string | null>(null)
  const [continueBusy, setContinueBusy] = useState(false)
  /** Only show session loading when switching sessions; silent refetch when list polling bumps the head record. */
  const prevFetchedMultistopSessionIdRef = useRef<string | null>(null)

  const sessionId = group ? group.sessionId.trim() : ''
  const rolledUp = useMemo(() => {
    if (!group?.head || !group?.latest) return null
    const latest = group.latest
    const head = group.head
    return {
      ...head,
      last_status: latest.last_status,
      worker_closed: latest.worker_closed,
      finalized: latest.finalized,
      updated_at: latest.updated_at,
      multistop_session_id: group.sessionId,
      multistop_segment_count: group.segmentCount,
      multistop_session_status: head.multistop_session_status ?? latest.multistop_session_status,
    } as MissionRecordRow
  }, [group])

  useEffect(() => {
    if (!group) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [group, onClose])

  useEffect(() => {
    if (!sessionId) {
      prevFetchedMultistopSessionIdRef.current = null
      setMsData(null)
      setMsErr(null)
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
        setMsData({ session: d.session, records: d.records as MissionRecordRow[] })
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
    /** Same-session refetch (parent rollup / Continue) does not toggle msLoading — avoids flash. */
  }, [sessionId, msRefresh, rolledUp?.updated_at, rolledUp?.last_status])

  const nextSeg = useMemo(() => {
    if (!msData?.session) return 0
    const n = Number(msData.session.next_segment_index)
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  }, [msData])

  const totalSeg = useMemo(() => {
    if (!msData?.session) return 0
    const n = Number(msData.session.total_segments)
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  }, [msData])

  const sessionStatus = msData?.session?.status != null ? String(msData.session.status) : ''
  const stForBuckets =
    sessionStatus || String(rolledUp?.multistop_session_status ?? '').trim() || 'pending'
  const pickupPos =
    msData?.session?.pickup_position != null ? String(msData.session.pickup_position) : null
  const parsedPlan = useMemo(() => parseSessionPlan(msData?.session?.plan_json), [msData?.session?.plan_json])
  const plan = parsedPlan?.destinations ?? null

  const recordByStep = useMemo(() => {
    const m = new Map<number, MissionRecordRow>()
    if (!msData?.records) return m
    for (const r of msData.records) {
      m.set(msStepIndex(r), r)
    }
    return m
  }, [msData])

  const awaitingContinue = msData
    ? sessionStatus === 'awaiting_continue'
    : stForBuckets === 'awaiting_continue'
  const continueEnabled = canManage && awaitingContinue && nextSeg < totalSeg && Boolean(msData)

  const continueNotBeforeRaw = msData?.session?.continue_not_before
  const continueNotBeforeIso =
    typeof continueNotBeforeRaw === 'string' && continueNotBeforeRaw.trim()
      ? continueNotBeforeRaw.trim()
      : null

  /** Leg that is in progress or waiting for Continue — scroll this into view in the route list. */
  const focusLegIndex = useMemo(() => {
    const legCount = totalSeg > 0 ? totalSeg : plan?.length ?? 0
    if (!rolledUp || legCount === 0) return null
    const indices = Array.from({ length: legCount }, (_, i) => i)
    const totalOrFallback = totalSeg || indices.length
    for (const i of indices) {
      const b = segmentBucket(i, stForBuckets, nextSeg, totalOrFallback)
      if (b === 'current' || b === 'next_continue') return i
    }
    return indices[indices.length - 1] ?? null
  }, [rolledUp, totalSeg, plan, stForBuckets, nextSeg])

  const focusLegRef = useRef<HTMLLIElement | null>(null)
  const didScrollOnOpenRef = useRef(false)

  useEffect(() => {
    didScrollOnOpenRef.current = false
  }, [sessionId])

  useEffect(() => {
    if (!rolledUp || msLoading || focusLegIndex === null) return
    if (didScrollOnOpenRef.current) return
    didScrollOnOpenRef.current = true
    let innerRaf = 0
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        focusLegRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' })
      })
    })
    return () => {
      cancelAnimationFrame(outerRaf)
      cancelAnimationFrame(innerRaf)
    }
  }, [rolledUp, msLoading, focusLegIndex])

  const onContinue = async () => {
    if (!sessionId) return
    setContinueBusy(true)
    setMsErr(null)
    try {
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

  if (!group || !rolledUp) return null

  const payload = parsePayload(rolledUp)
  const payloadRobotIds = submitRobotIdsFromPayload(payload)
  const unlockRobotFromPayload = unlockRobotIdFromPayload(payload)
  const jobCode = String(rolledUp.job_code ?? '')
  const missionCode = String(rolledUp.mission_code ?? '')
  const lockedRobotFromSession =
    msData?.session && typeof msData.session.locked_robot_id === 'string'
      ? String(msData.session.locked_robot_id).trim()
      : ''
  const sessionContainerFromMs =
    msData?.session && typeof msData.session.container_code === 'string'
      ? String(msData.session.container_code).trim()
      : ''
  const containerDisplayPrimary =
    String(rolledUp.container_code ?? '').trim() || sessionContainerFromMs || ''
  const robotDisplayPrimary =
    lockedRobotFromSession ||
    unlockRobotFromPayload ||
    (payloadRobotIds.length > 0 ? payloadRobotIds.join(', ') : '')
  const robotPrimaryHeading =
    lockedRobotFromSession ? 'Robot (session)' : unlockRobotFromPayload ? 'Robot (this stop)' : 'Robot(s)'
  const fleetPoolStr = payloadRobotIds.join(', ')
  const showFleetPoolLine =
    payloadRobotIds.length > 0 && fleetPoolStr !== robotDisplayPrimary && Boolean(robotDisplayPrimary)

  const createdRaw = rolledUp.created_at
  const updatedRaw = rolledUp.updated_at
  const createdAt =
    typeof createdRaw === 'string' || createdRaw instanceof Date ? formatDateTime(createdRaw as string | Date) : '—'
  const updatedAt =
    typeof updatedRaw === 'string' || updatedRaw instanceof Date ? formatDateTime(updatedRaw as string | Date) : '—'

  const legIndices =
    totalSeg > 0
      ? Array.from({ length: totalSeg }, (_, i) => i)
      : plan
        ? Array.from({ length: plan.length }, (_, i) => i)
        : []

  /** Portal to `document.body` so `fixed inset-0` covers the viewport (not clipped/stacked inside `main`). */
  const modal = (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="multistop-summary-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p
              id="multistop-summary-title"
              className="text-xs font-medium tracking-wide text-foreground/55"
            >
              Mission Overview
            </p>
            <p className="mt-1 break-all font-mono text-base font-semibold leading-snug text-foreground">
              {jobCode || missionCode || '—'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {rolledUp.last_status != null ? (
                <MissionJobStatusBadge value={rolledUp.last_status} />
              ) : (
                <span className="text-sm text-foreground/50">No fleet status on latest stop</span>
              )}
              <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                {String(rolledUp.mission_type ?? 'RACK_MOVE')}
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {isChainedMultistopGroup(group) ? 'Multi-stop' : 'Route'}
              </span>
              {stForBuckets ? (
                <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground/75">
                  {friendlyMultistopSessionStatus(stForBuckets)}
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
                    Fleet pool: <span className="font-mono text-foreground/70">{fleetPoolStr}</span>
                  </p>
                ) : null}
              </div>
            </div>
            <p className="mt-3 text-[11px] text-foreground/50">
              Created {createdAt} · Updated {updatedAt}
            </p>
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
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Route stops</h3>
            {pickupPos ? (
              <div className="space-y-1">
                <p className="text-sm text-foreground/80">
                  Pickup: <span className="font-mono">{pickupPos}</span>
                </p>
                {parsedPlan?.pickupContinue ? (
                  <p className="text-xs text-foreground/65">{formatPickupRelease(parsedPlan.pickupContinue)}</p>
                ) : null}
              </div>
            ) : null}
            {msLoading ? <p className="text-sm text-foreground/60">Loading session…</p> : null}
            {msErr ? <p className="text-sm text-red-600">{msErr}</p> : null}
            {!msLoading && legIndices.length === 0 ? (
              <p className="text-sm text-foreground/60">No route stops loaded yet.</p>
            ) : null}
            <ul className="space-y-2">
              {legIndices.map((i) => {
                const bucket = segmentBucket(i, stForBuckets, nextSeg, totalSeg || legIndices.length)
                const { start, end } = segmentLegEndpoints(i, plan, pickupPos)
                const rec = recordByStep.get(i)
                const destCount = plan?.length ?? legIndices.length
                const isLastStop = destCount > 0 && i === destCount - 1
                return (
                  <li
                    key={i}
                    ref={i === focusLegIndex ? focusLegRef : undefined}
                    className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm scroll-mt-3 ${bucketRowClass(
                      bucket
                    )}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-foreground/80">
                        Stop {i + 1}
                        {legIndices.length ? ` of ${legIndices.length}` : ''}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          bucket === 'next_continue'
                            ? 'bg-amber-500/20 text-amber-950 dark:text-amber-100'
                            : bucket === 'current'
                              ? 'bg-primary/15 text-primary'
                              : 'bg-muted/80 text-foreground/70'
                        }`}
                      >
                        {bucketLabel(bucket)}
                      </span>
                      {rec?.last_status != null ? (
                        <MissionJobStatusBadge value={rec.last_status as number} />
                      ) : null}
                    </div>
                    <p className="break-all font-mono text-xs leading-relaxed text-foreground/85">
                      <span className="text-foreground/50">From </span>
                      {start}
                      <span className="mx-1 text-foreground/35">→</span>
                      <span className="text-foreground/50">To </span>
                      {end}
                    </p>
                    {rec?.job_code ? (
                      <p className="font-mono text-[10px] text-foreground/55">{String(rec.job_code)}</p>
                    ) : null}
                    {bucket === 'upcoming' ? (
                      <p className="text-xs text-foreground/65">
                        {formatReleaseAfterDestination(plan?.[i], isLastStop)}
                      </p>
                    ) : null}
                    {bucket === 'next_continue' && continueNotBeforeIso ? (
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs" aria-live="polite">
                        <AmrAutoContinueCountdown
                          continueNotBeforeIso={continueNotBeforeIso}
                          className="text-xs font-medium tabular-nums text-foreground/85"
                        />
                        <span className="text-foreground/60">— Continue below to override</span>
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>

            {awaitingContinue && !canManage ? (
              <p className="text-xs text-foreground/60">Continue requires mission management permission.</p>
            ) : null}
          </section>
        </div>

        <div className="shrink-0 border-t border-border bg-card px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={!continueEnabled || continueBusy}
              className="min-h-[44px] w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35 sm:w-auto"
              onClick={() => void onContinue()}
            >
              {continueBusy
                ? 'Continuing…'
                : continueNotBeforeIso
                  ? 'Continue now'
                  : nextSeg === 0
                    ? 'Start mission'
                    : 'Continue to next stop'}
            </button>
            <button
              type="button"
              className="min-h-[44px] w-full rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-muted sm:w-auto"
              onClick={() => {
                onOpenFullMission(headRecordForMissionDetail(group))
                onClose()
              }}
            >
              Open full mission editor
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
