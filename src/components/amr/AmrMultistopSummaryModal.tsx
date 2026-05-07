import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  cancelAmrMultistopSession,
  continueAmrMultistopSession,
  getAmrMultistopSession,
  getAmrSettings,
  getAmrStandGroups,
  getAmrStands,
  postStandPresence,
  terminateStuckAmrMultistopSession,
} from '@/api/amr'
import { AmrAutoContinueCountdown } from '@/components/amr/AmrAutoContinueCountdown'
import { AmrStandOccupiedContinueModal } from '@/components/amr/AmrStandOccupiedContinueModal'
import { AmrStandPresenceRow } from '@/components/amr/AmrStandPresenceRow'
import { PalletPresenceGlyph, palletPresenceKindFromState } from '@/components/amr/PalletPresenceGlyph'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'
import {
  flattenGroupedMissionRow,
  friendlyMultistopSessionStatus,
  headRecordForMissionDetail,
  isChainedMultistopGroup,
  type GroupedMissionMultistop,
} from '@/utils/amrMultistopDisplay'
import { getApiErrorMessage, parseMultistopContinueStandOccupied } from '@/api/client'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAuthStore } from '@/store/authStore'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  MISSION_QUEUED_ROUTE_LEG_CARD_CLASS,
  missionOverviewOrDetailQueuedHue,
} from '@/utils/amrMissionJobStatus'
import {
  multistopContinueOccupiedDestinationRef,
  multistopContinueReleaseDisabledUntilStandShowsEmpty,
  multistopStandOccupiedContinueMessage,
  parseMultistopReleasePlanDestinations,
  refBypassesPalletCheck,
  sessionNextSegmentIndex,
  standRefsBypassingPalletCheck,
} from '@/utils/amrPalletPresenceSanity'

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
  /** Lazy-resolve pool (stop 2+); `position` may be empty until dispatch. */
  groupId?: string
  continueMode?: 'manual' | 'auto'
  autoContinueSeconds?: number
  /** Fleet arrival NODE at this destination; final segment treated as Lower in UI. */
  putDown?: boolean
}

type ParsedSessionPlan = {
  destinations: PlanDest[]
  pickupContinue?: { continueMode: 'manual' | 'auto'; autoContinueSeconds?: number }
  /** Per-segment fleet putDown at first NODE_POINT (Depart). */
  segmentFirstNodePutDown?: boolean[]
}

function parseSessionPlan(planJson: unknown): ParsedSessionPlan | null {
  if (typeof planJson !== 'string' || !planJson.trim()) return null
  try {
    const o = JSON.parse(planJson) as {
      destinations?: unknown
      pickupContinue?: unknown
      segmentFirstNodePutDown?: unknown
    }
    if (!Array.isArray(o.destinations)) return null
    const out: PlanDest[] = []
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
      const entry: PlanDest = { position, continueMode: cm }
      if (groupId) entry.groupId = groupId
      if (typeof row.putDown === 'boolean') entry.putDown = row.putDown
      if (cm === 'auto' && Number.isFinite(n) && n >= 0) {
        entry.autoContinueSeconds = Math.min(Math.max(0, Math.floor(n)), 86400)
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
      if (pcm === 'auto' && Number.isFinite(pn) && pn >= 0) {
        pickupContinue = {
          continueMode: 'auto',
          autoContinueSeconds: Math.min(Math.max(0, Math.floor(pn)), 86400),
        }
      } else {
        pickupContinue = { continueMode: 'manual' }
      }
    }
    let segmentFirstNodePutDown: boolean[] | undefined
    if (Array.isArray(o.segmentFirstNodePutDown)) {
      segmentFirstNodePutDown = o.segmentFirstNodePutDown.map((x) => x === true || x === 'true')
    }
    const base: ParsedSessionPlan = pickupContinue
      ? { destinations: out, pickupContinue }
      : { destinations: out }
    if (segmentFirstNodePutDown && segmentFirstNodePutDown.length > 0) {
      base.segmentFirstNodePutDown = segmentFirstNodePutDown
    }
    return base
  } catch {
    return null
  }
}

function formatPickupRelease(pc: { continueMode: 'manual' | 'auto'; autoContinueSeconds?: number }): string {
  if (pc.continueMode === 'auto' && typeof pc.autoContinueSeconds === 'number') {
    if (pc.autoContinueSeconds === 0) return 'Before first leg: Auto-release immediately'
    if (pc.autoContinueSeconds >= 1) return `Before first leg: Auto-release after ${pc.autoContinueSeconds}s`
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
    if (typeof s === 'number' && Number.isFinite(s) && s === 0) {
      return 'After arrival: Auto-release immediately'
    }
    if (typeof s === 'number' && Number.isFinite(s) && s >= 1) {
      return `After arrival: Auto-release after ${s}s`
    }
  }
  return 'After arrival: Manual release'
}

function planDestEndpointLabel(
  row: PlanDest | undefined,
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

/** Stand refs only — not `[group] …` labels (no Hyperion row). */
function isHyperionPollableStandRef(ref: string): boolean {
  const t = ref.trim()
  if (!t || t === '—') return false
  return !t.startsWith('[group]')
}

function segmentLegEndpoints(
  si: number,
  plan: PlanDest[] | null | undefined,
  pickup: string | null,
  groupNames?: Record<string, string>
): { start: string; end: string } {
  const p = plan ?? []
  const end = planDestEndpointLabel(p[si], groupNames)
  const start =
    si === 0 ? pickup?.trim() || '—' : planDestEndpointLabel(p[si - 1], groupNames)
  return { start, end }
}

type LegBucket = 'completed' | 'current' | 'next_continue' | 'upcoming' | 'done'

/** Matches worker `CLOSE_MISSION_ROW_STATUS` — row still open on Warning (50) even if session already advanced. */
const FLEET_STATUSES_CLOSED_MISSION_ROW = new Set([30, 31, 35])

function isMissionRecordFleetClosed(rec: MissionRecordRow | undefined): boolean {
  if (!rec) return false
  const wc = rec.worker_closed ?? (rec as { workerClosed?: unknown }).workerClosed
  if (wc === true) return true
  if (wc === false || wc === null || wc === undefined) {
    /* continue */
  } else if (typeof wc === 'string') {
    const t = wc.trim().toLowerCase()
    if (t === '1' || t === 'true') return true
    const n = Number(wc.trim())
    if (Number.isFinite(n) && n === 1) return true
  } else {
    const n = Number(wc)
    if (Number.isFinite(n) && n === 1) return true
  }
  const ls = rec.last_status ?? (rec as { lastStatus?: unknown }).lastStatus
  const statusNum = typeof ls === 'number' && Number.isFinite(ls) ? ls : Number(ls)
  return Number.isFinite(statusNum) && FLEET_STATUSES_CLOSED_MISSION_ROW.has(statusNum)
}

function segmentBucket(
  i: number,
  st: string,
  nextSeg: number,
  _total: number,
  rec: MissionRecordRow | undefined
): LegBucket {
  if (st === 'completed' || st === 'cancelled') return 'done'
  if (st === 'failed') {
    if (i < nextSeg) return isMissionRecordFleetClosed(rec) ? 'completed' : 'upcoming'
    return 'upcoming'
  }
  if (st === 'awaiting_continue') {
    if (i < nextSeg) return isMissionRecordFleetClosed(rec) ? 'completed' : 'current'
    if (i === nextSeg) return 'next_continue'
    return 'upcoming'
  }
  if (st === 'active') {
    if (nextSeg <= 0) return 'upcoming'
    if (i < nextSeg - 1) return isMissionRecordFleetClosed(rec) ? 'completed' : 'upcoming'
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
  const canForceRelease = useAuthStore((s) => s.hasPermission('amr.missions.force_release'))
  const [msRefresh, setMsRefresh] = useState(0)
  const [msData, setMsData] = useState<{ session: Record<string, unknown>; records: MissionRecordRow[] } | null>(null)
  const [msLoading, setMsLoading] = useState(false)
  const [msErr, setMsErr] = useState<string | null>(null)
  /** Set when pallet-at-stand blocks continue (client check or API 409 STAND_OCCUPIED). */
  const [continueBlockedStandRef, setContinueBlockedStandRef] = useState<string | null>(null)
  const [standOccupiedModalDismissed, setStandOccupiedModalDismissed] = useState(false)
  /** Hyperion snapshot for {@link continueBlockedStandRef} while destination-not-empty is shown. */
  const [blockedDestPresence, setBlockedDestPresence] = useState<boolean | null>(null)
  const [blockedDestPresenceLoading, setBlockedDestPresenceLoading] = useState(false)
  const [blockedDestPresenceError, setBlockedDestPresenceError] = useState(false)
  const [blockedDestPresenceUnconfig, setBlockedDestPresenceUnconfig] = useState(false)
  const [continueBusy, setContinueBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [terminateStuckBusy, setTerminateStuckBusy] = useState(false)
  const [terminateStuckConfirmOpen, setTerminateStuckConfirmOpen] = useState(false)
  const [forceReleaseConfirmOpen, setForceReleaseConfirmOpen] = useState(false)
  /** Only show session loading when switching sessions; silent refetch when list polling bumps the head record. */
  const prevFetchedMultistopSessionIdRef = useRef<string | null>(null)
  const [palletPresenceBypassRefs, setPalletPresenceBypassRefs] = useState(() => new Set<string>())
  const [standPresenceMap, setStandPresenceMap] = useState<Record<string, boolean | null>>({})
  const [standPresenceLoading, setStandPresenceLoading] = useState(false)
  const [standPresenceError, setStandPresenceError] = useState(false)
  const [standPresenceUnconfig, setStandPresenceUnconfig] = useState(false)
  /** Same auto-refresh cadence as Containers / Mission New / Stand Picker — sourced from AMR settings. */
  const [pollMsContainers, setPollMsContainers] = useState(5000)
  const [standPresenceSanityOn, setStandPresenceSanityOn] = useState(true)
  const [standGroupNameById, setStandGroupNameById] = useState<Record<string, string>>({})

  useEffect(() => {
    void getAmrStands().then((rows) => setPalletPresenceBypassRefs(standRefsBypassingPalletCheck(rows)))
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
    let cancelled = false
    void getAmrSettings().then((s) => {
      if (cancelled) return
      setPollMsContainers(Math.max(3000, s.pollMsContainers))
      setStandPresenceSanityOn(s.missionCreateStandPresenceSanityCheck !== false && s.missionQueueingEnabled === false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const sessionId = group ? group.sessionId.trim() : ''
  const rolledUp = useMemo((): MissionRecordRow | null => {
    if (!group?.head || !group?.latest) return null
    return flattenGroupedMissionRow(group) as MissionRecordRow
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
      setContinueBlockedStandRef(null)
      return
    }
    const sessionIdChanged = prevFetchedMultistopSessionIdRef.current !== sessionId
    prevFetchedMultistopSessionIdRef.current = sessionId
    if (sessionIdChanged) {
      setMsLoading(true)
    }
    setMsErr(null)
    setContinueBlockedStandRef(null)
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
  const recordCount = msData?.records?.length ?? 0
  const cancelEnabled =
    canManage &&
    Boolean(msData) &&
    sessionStatus === 'awaiting_continue' &&
    nextSeg === 0 &&
    recordCount === 0 &&
    !msLoading
  const terminateStuckEnabled =
    canManage && Boolean(msData) && sessionStatus === 'failed' && !msLoading && Boolean(sessionId)

  const continueNotBeforeRaw = msData?.session?.continue_not_before
  const continueNotBeforeIso =
    typeof continueNotBeforeRaw === 'string' && continueNotBeforeRaw.trim()
      ? continueNotBeforeRaw.trim()
      : null

  /** Same parsing as Continue — session plan includes `putDown` per segment (route card UI plan does not). */
  const continuePlanForOccupiedRef = useMemo(() => {
    const raw = msData?.session != null ? (msData.session as Record<string, unknown>).plan_json ?? (msData.session as Record<string, unknown>).planJson : undefined
    return parseMultistopReleasePlanDestinations(raw)
  }, [msData?.session])

  const nextContinueOccupiedCheckRef = useMemo(() => {
    if (!continuePlanForOccupiedRef || !Number.isFinite(nextSeg)) return null
    return multistopContinueOccupiedDestinationRef(continuePlanForOccupiedRef, nextSeg)
  }, [continuePlanForOccupiedRef, nextSeg])

  const continueReleaseDisabledUntilStandEmpty = useMemo(
    () =>
      multistopContinueReleaseDisabledUntilStandShowsEmpty({
        sanityEnabled: standPresenceSanityOn,
        nextOccupiedCheckRef: nextContinueOccupiedCheckRef,
        bypassRefs: palletPresenceBypassRefs,
        presenceMap: standPresenceMap,
        routePresenceUnconfig: standPresenceUnconfig,
        routePresenceError: standPresenceError,
      }),
    [
      standPresenceSanityOn,
      nextContinueOccupiedCheckRef,
      palletPresenceBypassRefs,
      standPresenceMap,
      standPresenceUnconfig,
      standPresenceError,
    ]
  )

  /** Leg that is in progress or waiting for Continue — scroll this into view in the route list. */
  const focusLegIndex = useMemo(() => {
    const legCount = totalSeg > 0 ? totalSeg : plan?.length ?? 0
    if (!rolledUp || legCount === 0) return null
    const indices = Array.from({ length: legCount }, (_, i) => i)
    const totalOrFallback = totalSeg || indices.length
    for (const i of indices) {
      const b = segmentBucket(i, stForBuckets, nextSeg, totalOrFallback, recordByStep.get(i))
      if (b === 'current' || b === 'next_continue') return i
    }
    return indices[indices.length - 1] ?? null
  }, [rolledUp, totalSeg, plan, stForBuckets, nextSeg, recordByStep])

  /** Stand refs used as From/To across every visible leg card — drives `postStandPresence` queries. */
  const legStandRefs = useMemo(() => {
    const legCount = totalSeg > 0 ? totalSeg : plan?.length ?? 0
    if (legCount === 0) return [] as string[]
    const set = new Set<string>()
    for (let i = 0; i < legCount; i += 1) {
      const { start, end } = segmentLegEndpoints(i, plan, pickupPos, standGroupNameById)
      const a = start.trim()
      const b = end.trim()
      if (a && a !== '—' && isHyperionPollableStandRef(a)) set.add(a)
      if (b && b !== '—' && isHyperionPollableStandRef(b)) set.add(b)
    }
    return [...set].sort()
  }, [totalSeg, plan, pickupPos, standGroupNameById])

  const legStandRefsKey = legStandRefs.join('\0')

  /** Next Continue stand + stand-occupied dialog ref — always included in auto-refresh. */
  const presencePollRefs = useMemo(() => {
    const set = new Set<string>()
    for (const r of legStandRefs) {
      const t = r.trim()
      if (t) set.add(t)
    }
    const nc = nextContinueOccupiedCheckRef?.trim()
    if (nc) set.add(nc)
    const cb = continueBlockedStandRef?.trim()
    if (cb) set.add(cb)
    return [...set].sort()
  }, [legStandRefsKey, nextContinueOccupiedCheckRef, continueBlockedStandRef])

  const presencePollRefsKey = presencePollRefs.join('\0')

  const loadPresenceForRefs = useCallback(
    async (refs: string[], opts?: { silent?: boolean }) => {
      if (refs.length === 0) return
      const silent = opts?.silent === true
      if (!silent) {
        setStandPresenceLoading(true)
        setStandPresenceError(false)
        setStandPresenceUnconfig(false)
      }
      try {
        const map = await postStandPresence(refs)
        setStandPresenceMap((prev) => {
          const next = { ...prev }
          for (const r of refs) {
            next[r] = Object.prototype.hasOwnProperty.call(map, r) ? map[r] : null
          }
          return next
        })
        setStandPresenceError(false)
        setStandPresenceUnconfig(false)
      } catch (e: unknown) {
        if (silent) return
        const status = (e as { response?: { status?: number } })?.response?.status
        if (status === 503) setStandPresenceUnconfig(true)
        else setStandPresenceError(true)
      } finally {
        if (!silent) setStandPresenceLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (presencePollRefs.length === 0) return
    void loadPresenceForRefs(presencePollRefs, { silent: true })
  }, [presencePollRefsKey, loadPresenceForRefs, presencePollRefs])

  useEffect(() => {
    if (presencePollRefs.length === 0) return
    const tid = window.setInterval(() => {
      void loadPresenceForRefs(presencePollRefs, { silent: true })
    }, pollMsContainers)
    return () => clearInterval(tid)
  }, [presencePollRefsKey, loadPresenceForRefs, presencePollRefs, pollMsContainers])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (presencePollRefs.length === 0) return
      void loadPresenceForRefs(presencePollRefs, { silent: true })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [presencePollRefsKey, loadPresenceForRefs, presencePollRefs])

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
    setContinueBlockedStandRef(null)
    try {
      const settings = await getAmrSettings()
      if (msData?.session && settings.missionCreateStandPresenceSanityCheck !== false && settings.missionQueueingEnabled === false) {
        const session = msData.session as Record<string, unknown>
        const nextSeg = sessionNextSegmentIndex(session)
        const planRaw = session.plan_json ?? session.planJson
        const plan = parseMultistopReleasePlanDestinations(planRaw)
        const ref =
          Number.isFinite(nextSeg) && plan ? multistopContinueOccupiedDestinationRef(plan, nextSeg) : null
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
      setContinueBlockedStandRef(null)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { queued?: boolean; standOccupiedRef?: string; error?: string } } })?.response
        ?.data
      if (d?.queued) {
        const ref = typeof d.standOccupiedRef === 'string' ? d.standOccupiedRef.trim() : ''
        setMsErr(ref ? `Queued — waiting for destination ${ref} to clear.` : 'Queued — waiting for destination to clear.')
        setContinueBlockedStandRef(null)
      } else {
        setMsErr(getApiErrorMessage(e, 'Continue failed'))
        setContinueBlockedStandRef(parseMultistopContinueStandOccupied(e))
      }
    } finally {
      setContinueBusy(false)
    }
  }

  const onConfirmForceRelease = async () => {
    if (!sessionId || !continueBlockedStandRef) return
    setForceReleaseConfirmOpen(false)
    setContinueBusy(true)
    setMsErr(null)
    try {
      await continueAmrMultistopSession(sessionId, { forceRelease: true })
      setContinueBlockedStandRef(null)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
    } catch (e: unknown) {
      setMsErr(getApiErrorMessage(e, 'Force release failed'))
      setContinueBlockedStandRef(parseMultistopContinueStandOccupied(e))
    } finally {
      setContinueBusy(false)
    }
  }

  const onCancelMission = async () => {
    if (!sessionId || !cancelEnabled) return
    setCancelBusy(true)
    setMsErr(null)
    try {
      await cancelAmrMultistopSession(sessionId)
      setCancelConfirmOpen(false)
      onSessionUpdated?.()
      onClose()
    } catch (e: unknown) {
      const ax = e as {
        response?: { data?: { error?: string; fleet?: unknown; fleetStatus?: number } }
      }
      const d = ax?.response?.data
      const base = getApiErrorMessage(e, 'Cancel failed')
      const extra =
        d?.fleet != null ? ` (${typeof d.fleetStatus === 'number' ? `fleet HTTP ${d.fleetStatus}` : 'fleet error'})` : ''
      setMsErr(`${base}${extra}`)
    } finally {
      setCancelBusy(false)
    }
  }

  const onTerminateStuckSession = async () => {
    if (!sessionId || !terminateStuckEnabled) return
    setTerminateStuckBusy(true)
    setMsErr(null)
    try {
      await terminateStuckAmrMultistopSession(sessionId)
      setTerminateStuckConfirmOpen(false)
      setMsRefresh((n) => n + 1)
      onSessionUpdated?.()
      onClose()
    } catch (e: unknown) {
      setMsErr(getApiErrorMessage(e, 'Could not end failed session'))
    } finally {
      setTerminateStuckBusy(false)
    }
  }

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

  /** Matches footer “Release Mission” / “Release now” for the stand-occupied dialog primary action. */
  const standOccupiedReleaseRetryLabel = continueNotBeforeIso ? 'Release now' : 'Release Mission'

  if (!group || !rolledUp) return null

  const hideStandOccupiedInlineAlert =
    Boolean(continueBlockedStandRef) && !standOccupiedModalDismissed

  const payload = parsePayload(rolledUp)
  const payloadRobotIds = submitRobotIdsFromPayload(payload)
  const unlockRobotFromPayload = unlockRobotIdFromPayload(payload)
  const jobCode = String(rolledUp.job_code ?? '')
  const missionCode = String(rolledUp.mission_code ?? '')
  const lockedRobotFromSession =
    msData?.session && typeof msData.session.locked_robot_id === 'string'
      ? String(msData.session.locked_robot_id).trim()
      : ''
  /** Fallback from mission row when session lock has already rolled forward to the next leg. */
  const lockedRobotFromRecord =
    typeof rolledUp.locked_robot_id === 'string' && rolledUp.locked_robot_id.trim()
      ? rolledUp.locked_robot_id.trim()
      : ''
  const sessionContainerFromMs =
    msData?.session && typeof msData.session.container_code === 'string'
      ? String(msData.session.container_code).trim()
      : ''
  const containerDisplayPrimary =
    String(rolledUp.container_code ?? '').trim() || sessionContainerFromMs || ''
  const robotDisplayPrimary =
    lockedRobotFromSession ||
    lockedRobotFromRecord ||
    unlockRobotFromPayload ||
    (payloadRobotIds.length > 0 ? payloadRobotIds.join(', ') : '')
  const robotPrimaryHeading =
    lockedRobotFromSession
      ? 'Robot (session)'
      : lockedRobotFromRecord
        ? 'Robot (assigned)'
        : unlockRobotFromPayload
          ? 'Robot (this stop)'
          : 'Robot(s)'
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

  const sessionQueuedForStand = missionOverviewOrDetailQueuedHue({
    flat: rolledUp,
    session: msData?.session ? (msData.session as Record<string, unknown>) : null,
  })

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
          canForceRelease={canForceRelease}
          continueBusy={continueBusy}
          confirmDisabled={
            cancelBusy || terminateStuckBusy || continueReleaseDisabledUntilStandEmpty
          }
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Route stops</h3>
              <div className="flex items-center gap-2">
                {standPresenceUnconfig ? (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Hyperion not configured
                  </span>
                ) : standPresenceError ? (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Stand status error
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={presencePollRefs.length === 0 || standPresenceLoading}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground/80 hover:bg-muted disabled:opacity-50"
                  onClick={() => void loadPresenceForRefs(presencePollRefs)}
                  title="Refresh pallet presence for route stands and the next Continue destination"
                >
                  {standPresenceLoading ? 'Refreshing…' : 'Refresh stands'}
                </button>
              </div>
            </div>
            {pickupPos ? (
              <div className="space-y-1">
                <p className="text-sm text-foreground/80">
                  Pickup: <span className="font-mono">{pickupPos}</span>
                  {parsedPlan?.segmentFirstNodePutDown != null &&
                  parsedPlan.segmentFirstNodePutDown.length > 0 ? (
                    <>
                      <span className="text-foreground/35"> &gt; </span>
                      <span className="text-[10px] font-semibold uppercase text-foreground/75">
                        {parsedPlan.segmentFirstNodePutDown[0] === true ? 'LOWER' : 'LIFT'}
                      </span>
                    </>
                  ) : null}
                </p>
                {parsedPlan?.pickupContinue ? (
                  <p className="text-xs text-foreground/65">{formatPickupRelease(parsedPlan.pickupContinue)}</p>
                ) : null}
              </div>
            ) : null}
            {msLoading ? <p className="text-sm text-foreground/60">Loading session…</p> : null}
            {!msLoading && legIndices.length === 0 ? (
              <p className="text-sm text-foreground/60">No route stops loaded yet.</p>
            ) : null}
            <ul className="space-y-2">
              {legIndices.map((i) => {
                const bucket = segmentBucket(i, stForBuckets, nextSeg, totalSeg || legIndices.length, recordByStep.get(i))
                const { start, end } = segmentLegEndpoints(i, plan, pickupPos, standGroupNameById)
                const rec = recordByStep.get(i)
                const destCount = plan?.length ?? legIndices.length
                const isLastStop = destCount > 0 && i === destCount - 1
                const departLower = parsedPlan?.segmentFirstNodePutDown?.[i] === true
                const arriveLower = isLastStop ? true : plan?.[i]?.putDown === true
                const legQueued =
                  sessionQueuedForStand && i === nextSeg && bucket === 'next_continue'
                return (
                  <li
                    key={i}
                    ref={i === focusLegIndex ? focusLegRef : undefined}
                    className={`rounded-lg border px-3 py-2.5 text-sm scroll-mt-3 ${
                      legQueued ? MISSION_QUEUED_ROUTE_LEG_CARD_CLASS : bucketRowClass(bucket)
                    }`}
                  >
                    <div className="flex flex-nowrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-foreground/80">
                            Stop {i + 1}
                            {legIndices.length ? ` of ${legIndices.length}` : ''}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              legQueued
                                ? 'bg-violet-400/25 text-violet-950 dark:bg-violet-500/25 dark:text-violet-100'
                                : bucket === 'next_continue'
                                  ? 'bg-amber-500/20 text-amber-950 dark:text-amber-100'
                                  : bucket === 'current'
                                    ? 'bg-primary/15 text-primary'
                                    : 'bg-muted/80 text-foreground/70'
                            }`}
                          >
                            {legQueued ? 'Queued' : bucketLabel(bucket)}
                          </span>
                          {rec?.last_status != null ? (
                            <MissionJobStatusBadge value={rec.last_status as number} />
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          <AmrStandPresenceRow
                            label="From"
                            standRef={start}
                            presenceMap={standPresenceMap}
                            loading={standPresenceLoading}
                            error={standPresenceError}
                            unconfigured={standPresenceUnconfig}
                            bypassRefs={palletPresenceBypassRefs}
                            forkAction={departLower ? 'lower' : 'lift'}
                          />
                          <AmrStandPresenceRow
                            label="To"
                            standRef={end}
                            presenceMap={standPresenceMap}
                            loading={standPresenceLoading}
                            error={standPresenceError}
                            unconfigured={standPresenceUnconfig}
                            bypassRefs={palletPresenceBypassRefs}
                            forkAction={arriveLower ? 'lower' : 'lift'}
                          />
                        </div>
                        {rec?.job_code ? (
                          <p className="font-mono text-[10px] text-foreground/55">{String(rec.job_code)}</p>
                        ) : null}
                        {bucket === 'upcoming' ? (
                          <p className="text-xs text-foreground/65">
                            {formatReleaseAfterDestination(plan?.[i], isLastStop)}
                          </p>
                        ) : null}
                      </div>
                      {bucket === 'next_continue' && continueNotBeforeIso ? (
                        <div
                          className="flex shrink-0 flex-col items-end justify-start gap-1 text-right"
                          aria-live="polite"
                        >
                          <AmrAutoContinueCountdown
                            continueNotBeforeIso={continueNotBeforeIso}
                            className="text-lg font-semibold tabular-nums text-foreground sm:text-xl"
                          />
                          <span className="max-w-[11rem] text-[10px] leading-snug text-foreground/55">
                            Release below to override
                          </span>
                        </div>
                      ) : null}
                    </div>
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
          {msErr && !hideStandOccupiedInlineAlert ? (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium leading-snug text-red-600 dark:border-red-500/35 dark:bg-red-950/40 dark:text-red-400"
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
                      continueBusy ||
                      cancelBusy ||
                      terminateStuckBusy ||
                      continueReleaseDisabledUntilStandEmpty
                    }
                    className="min-h-[40px] w-full rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 sm:w-auto"
                    onClick={() => void onContinue()}
                  >
                    Retry
                  </button>
                  {canForceRelease ? (
                    <button
                      type="button"
                      disabled={continueBusy || cancelBusy || terminateStuckBusy}
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
          <ConfirmModal
            open={forceReleaseConfirmOpen}
            title="Force release"
            variant="amber"
            message={
              continueBlockedStandRef ? (
                <span>
                  Hyperion still reports a pallet at stand{' '}
                  <span className="font-mono">{continueBlockedStandRef}</span>. Force only if the stand is actually
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
            open={cancelConfirmOpen}
            title="Cancel mission"
            message={
              <span>
                This removes the container from the pickup stand on the fleet and abandons this multi-stop session. You
                can only do this before the first leg has been submitted.
              </span>
            }
            confirmLabel={cancelBusy ? 'Cancelling…' : 'Cancel mission'}
            variant="danger"
            onCancel={() => {
              if (!cancelBusy) setCancelConfirmOpen(false)
            }}
            onConfirm={() => void onCancelMission()}
          />
          <ConfirmModal
            open={terminateStuckConfirmOpen}
            title="End failed session"
            message={
              <span>
                This session is marked <strong className="font-medium">failed</strong> and cannot Continue. DC will stop
                tracking it, close all related mission rows, and call fleet <strong className="font-medium">missionCancel</strong>{' '}
                for each segment job code (best effort). Use only after the robots are safe and you accept fleet-side
                effects.
              </span>
            }
            confirmLabel={terminateStuckBusy ? 'Ending…' : 'End session'}
            variant="danger"
            onCancel={() => {
              if (!terminateStuckBusy) setTerminateStuckConfirmOpen(false)
            }}
            onConfirm={() => void onTerminateStuckSession()}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              {cancelEnabled ? (
                <button
                  type="button"
                  disabled={cancelBusy || continueBusy || terminateStuckBusy}
                  className="min-h-[44px] w-full rounded-lg border border-red-500/45 bg-background px-4 text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400 sm:w-auto"
                  onClick={() => setCancelConfirmOpen(true)}
                >
                  Cancel mission
                </button>
              ) : null}
              {terminateStuckEnabled ? (
                <button
                  type="button"
                  disabled={terminateStuckBusy || continueBusy || cancelBusy}
                  className="min-h-[44px] w-full rounded-lg border border-red-600/50 bg-background px-4 text-sm font-medium text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300 sm:w-auto"
                  onClick={() => setTerminateStuckConfirmOpen(true)}
                >
                  {terminateStuckBusy ? 'Ending…' : 'End failed session'}
                </button>
              ) : null}
              <button
                type="button"
                disabled={
                  !continueEnabled ||
                  continueBusy ||
                  cancelBusy ||
                  terminateStuckBusy ||
                  continueReleaseDisabledUntilStandEmpty
                }
                title={
                  continueReleaseDisabledUntilStandEmpty
                    ? 'Release stays off until Hyperion reports the next drop stand as empty'
                    : undefined
                }
                className="min-h-[44px] w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35 sm:w-auto"
                onClick={() => void onContinue()}
              >
                {continueBusy
                  ? 'Releasing…'
                  : continueNotBeforeIso
                    ? 'Release now'
                    : 'Release Mission'}
              </button>
            </div>
            <button
              type="button"
              disabled={cancelBusy || continueBusy || terminateStuckBusy}
              className="min-h-[44px] w-full rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-50 sm:w-auto"
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
