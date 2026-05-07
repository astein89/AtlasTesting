import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  amrFleetProxy,
  getAmrMissionAttention,
  getAmrMissionRecords,
  getAmrSettings,
  pollMsAlignedWithMissionWorker,
  pollMsMissionsUi,
  type AmrMissionAttentionItem,
} from '@/api/amr'
import { AmrMissionCardAutoContinue } from '@/components/amr/AmrAutoContinueCountdown'
import { AmrFleetJobDetailModal } from '@/components/amr/AmrFleetJobDetailModal'
import { AmrMultistopSummaryModal } from '@/components/amr/AmrMultistopSummaryModal'
import { AmrMissionDetailModal } from '@/components/amr/AmrMissionDetailModal'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'
import {
  paginateSlice,
  SortableTh,
  TablePaginationBar,
  type SortDir,
} from '@/components/amr/AmrTablePagination'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAbortableEffect } from '@/hooks/useAbortableEffect'
import { isAbortLikeError } from '@/api/client'
import {
  APP_MISSION_DISPLAY_MAX_AGE_HOURS,
  filterAppMissionsRecentOrLive,
  HIDE_FLEET_COMPLETE_AFTER_MINUTE_OPTIONS,
  labelHideFleetCompleteOption,
} from '@/utils/amrAppMissions'
import {
  MISSION_QUEUED_ROW_TABLE_CLASS,
  missionJobStatusChipClass,
  missionRowIsQuietQueueWait,
} from '@/utils/amrMissionJobStatus'
import {
  expandMultistopSessionsForRecentWindow,
  filterGroupedMissionsHideStale,
  findMultistopGroupBySessionId,
  flattenGroupedMissionRow,
  friendlyMultistopSessionStatus,
  groupMissionRecords,
  headMissionRecordForSession,
  headRecordForMissionDetail,
  multistopRouteKindBadgeLabel,
  multistopSessionStatusFromGroup,
  multistopSessionWorkflowChipCode,
  multistopWaitingForFirstSegmentStart,
  partitionMissionGroupsForTables,
  resolvedMissionDetailRecord,
  type GroupedMissionRow,
} from '@/utils/amrMultistopDisplay'

const LS_HIDE_FLEET_COMPLETE_AFTER_MIN = 'amr.missions.hideFleetCompleteAfterMinutes'
/** Legacy: values were hours; migrated to minutes on first read. */
const LS_HIDE_FLEET_COMPLETE_AFTER_H = 'amr.missions.hideFleetCompleteAfterHours'

/** Local choice on this browser; if absent, missions page uses server default from AMR settings. */
function readHideFleetCompletePreference(): { minutes: number | null; hasLocalOverride: boolean } {
  try {
    const rawM = localStorage.getItem(LS_HIDE_FLEET_COMPLETE_AFTER_MIN)
    if (rawM != null) {
      const v = JSON.parse(rawM) as unknown
      if (v === null) return { minutes: null, hasLocalOverride: true }
      if (typeof v === 'number' && v > 0 && Number.isFinite(v))
        return { minutes: v, hasLocalOverride: true }
    }
    const rawH = localStorage.getItem(LS_HIDE_FLEET_COMPLETE_AFTER_H)
    if (rawH != null) {
      const v = JSON.parse(rawH) as unknown
      if (v === null) {
        localStorage.setItem(LS_HIDE_FLEET_COMPLETE_AFTER_MIN, JSON.stringify(null))
        localStorage.removeItem(LS_HIDE_FLEET_COMPLETE_AFTER_H)
        return { minutes: null, hasLocalOverride: true }
      }
      if (typeof v === 'number' && v > 0 && Number.isFinite(v)) {
        const mins = Math.round(v * 60)
        localStorage.setItem(LS_HIDE_FLEET_COMPLETE_AFTER_MIN, JSON.stringify(mins))
        localStorage.removeItem(LS_HIDE_FLEET_COMPLETE_AFTER_H)
        return { minutes: mins, hasLocalOverride: true }
      }
    }
  } catch {
    /* ignore */
  }
  return { minutes: null, hasLocalOverride: false }
}

function fleetJobsFromResponse(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const arr = (data as { data?: unknown }).data
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x))
}

type AppMissionSortCol =
  | 'job_code'
  | 'container_code'
  | 'last_status'
  | 'tracking'
  | 'created_at'
  | 'time_completed'

type FleetJobSortCol =
  | 'jobCode'
  | 'containerCode'
  | 'status'
  | 'robotId'
  | 'mapCode'
  | 'createTime'
  | 'source'

/** Default direction when switching columns on the Mission History table (newest created first). */
function defaultHistoryMissionSortDir(col: AppMissionSortCol): SortDir {
  if (col === 'job_code' || col === 'container_code') return 'asc'
  if (col === 'created_at' || col === 'last_status' || col === 'time_completed') return 'desc'
  return 'asc'
}

/** Default direction when switching columns on the Active Missions table (oldest created first for Created). */
function defaultActiveMissionSortDir(col: AppMissionSortCol): SortDir {
  if (col === 'job_code' || col === 'container_code') return 'asc'
  if (col === 'created_at') return 'asc'
  if (col === 'last_status') return 'desc'
  return 'asc'
}

function defaultFleetJobSortDir(col: FleetJobSortCol): SortDir {
  if (col === 'status' || col === 'createTime') return 'desc'
  return 'asc'
}

function compareAppMissionRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  col: AppMissionSortCol,
  dir: SortDir
): number {
  const m = dir === 'asc' ? 1 : -1
  switch (col) {
    case 'job_code':
      return String(a.job_code ?? '').localeCompare(String(b.job_code ?? ''), undefined, { sensitivity: 'base' }) * m
    case 'container_code':
      return (
        String(a.container_code ?? '').localeCompare(String(b.container_code ?? ''), undefined, {
          sensitivity: 'base',
        }) * m
      )
    case 'last_status': {
      const na = Number(a.last_status)
      const nb = Number(b.last_status)
      const va = Number.isFinite(na) ? na : Number.NEGATIVE_INFINITY
      const vb = Number.isFinite(nb) ? nb : Number.NEGATIVE_INFINITY
      return (va - vb) * m
    }
    case 'tracking': {
      const wa = Number(a.worker_closed) === 1 ? 1 : 0
      const wb = Number(b.worker_closed) === 1 ? 1 : 0
      return (wa - wb) * m
    }
    case 'created_at':
      return String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) * m
    case 'time_completed':
      return String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? '')) * m
    default:
      return 0
  }
}

function compareAppMissionGroups(
  a: GroupedMissionRow,
  b: GroupedMissionRow,
  col: AppMissionSortCol,
  dir: SortDir,
  attentionFirst: boolean,
  attentionSet: Set<string>
): number {
  const fa = flattenGroupedMissionRow(a)
  const fb = flattenGroupedMissionRow(b)
  if (attentionFirst) {
    const sa = String(fa.multistop_session_id ?? '').trim()
    const sb = String(fb.multistop_session_id ?? '').trim()
    const aa =
      Boolean(sa && attentionSet.has(sa)) && !missionRowIsQuietQueueWait(fa)
    const bb =
      Boolean(sb && attentionSet.has(sb)) && !missionRowIsQuietQueueWait(fb)
    if (aa !== bb) return aa ? -1 : 1
  }
  return compareAppMissionRows(fa, fb, col, dir)
}

function compareFleetJobRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  col: FleetJobSortCol,
  dir: SortDir
): number {
  const m = dir === 'asc' ? 1 : -1
  switch (col) {
    case 'jobCode':
      return String(a.jobCode ?? '').localeCompare(String(b.jobCode ?? ''), undefined, { sensitivity: 'base' }) * m
    case 'containerCode':
      return (
        String(a.containerCode ?? '').localeCompare(String(b.containerCode ?? ''), undefined, {
          sensitivity: 'base',
        }) * m
      )
    case 'status': {
      const na = Number(a.status)
      const nb = Number(b.status)
      const va = Number.isFinite(na) ? na : Number.NEGATIVE_INFINITY
      const vb = Number.isFinite(nb) ? nb : Number.NEGATIVE_INFINITY
      return (va - vb) * m
    }
    case 'robotId':
      return String(a.robotId ?? '').localeCompare(String(b.robotId ?? ''), undefined, { sensitivity: 'base' }) * m
    case 'mapCode':
      return String(a.mapCode ?? '').localeCompare(String(b.mapCode ?? ''), undefined, { sensitivity: 'base' }) * m
    case 'createTime':
      return String(a.createTime ?? '').localeCompare(String(b.createTime ?? '')) * m
    case 'source':
      return String(a.source ?? '').localeCompare(String(b.source ?? ''), undefined, { sensitivity: 'base' }) * m
    default:
      return 0
  }
}

export function AmrMissions() {
  const [searchParams, setSearchParams] = useSearchParams()
  const attentionFirst = searchParams.get('attention') === '1'
  const multistopSummaryParam =
    searchParams.get('multistopSummary')?.trim() ?? searchParams.get('openSession')?.trim() ?? ''
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [attentionBySession, setAttentionBySession] = useState(
    () => new Map<string, AmrMissionAttentionItem>()
  )
  const attentionSessionIds = useMemo(() => new Set(attentionBySession.keys()), [attentionBySession])
  const [fleetPayload, setFleetPayload] = useState<unknown>(null)
  const [fleetErr, setFleetErr] = useState('')
  const [appHydrated, setAppHydrated] = useState(false)
  const [fleetHydrated, setFleetHydrated] = useState(false)
  const loading = !appHydrated || !fleetHydrated
  const hidePref0 = readHideFleetCompletePreference()
  const [hideFleetCompleteAfterMinutes, setHideFleetCompleteAfterMinutes] = useState<number | null>(() =>
    hidePref0.hasLocalOverride ? hidePref0.minutes : 30
  )
  const [err, setErr] = useState('')
  const [seqApp, setSeqApp] = useState(0)
  const [seqFleet, setSeqFleet] = useState(0)
  const [pollMsWorker, setPollMsWorker] = useState(5000)
  const [pollMsMissionsInterval, setPollMsMissionsInterval] = useState(5000)
  const [detailMission, setDetailMission] = useState<Record<string, unknown> | null>(null)
  const [detailFleetJob, setDetailFleetJob] = useState<Record<string, unknown> | null>(null)
  const [multistopSummarySessionId, setMultistopSummarySessionId] = useState<string | null>(null)

  const [activeMissionSort, setActiveMissionSort] = useState<{ col: AppMissionSortCol; dir: SortDir }>({
    col: 'created_at',
    dir: 'asc',
  })
  const [historyMissionSort, setHistoryMissionSort] = useState<{ col: AppMissionSortCol; dir: SortDir }>({
    col: 'time_completed',
    dir: 'desc',
  })
  const [appPage, setAppPage] = useState(1)
  const [appPageSize, setAppPageSize] = useState(25)

  const [fleetSort, setFleetSort] = useState<{ col: FleetJobSortCol; dir: SortDir }>({
    col: 'jobCode',
    dir: 'asc',
  })
  const [fleetPage, setFleetPage] = useState(1)
  const [fleetPageSize, setFleetPageSize] = useState(25)

  useEffect(() => {
    void getAmrSettings().then((s) => {
      setPollMsWorker(pollMsAlignedWithMissionWorker(s))
      setPollMsMissionsInterval(pollMsMissionsUi(s))
      const pref = readHideFleetCompletePreference()
      if (!pref.hasLocalOverride) {
        setHideFleetCompleteAfterMinutes(s.hideFleetCompleteAfterMinutesDefault ?? 30)
      }
    })
  }, [])

  useAbortableEffect(
    (signal) => {
      setErr('')
      void getAmrMissionRecords({ signal })
        .then((r) => setRows(r))
        .catch((e) => {
          if (isAbortLikeError(e)) return
          setErr('Failed to load missions')
        })
        .finally(() => setAppHydrated(true))
      void getAmrMissionAttention({ signal })
        .then((att) => {
          const m = new Map<string, AmrMissionAttentionItem>()
          for (const i of att.items) {
            const sid = i.sessionId?.trim()
            if (sid) m.set(sid, i)
          }
          setAttentionBySession(m)
        })
        .catch((e) => {
          if (isAbortLikeError(e)) return
          setAttentionBySession(new Map())
        })
    },
    [seqApp]
  )

  useAbortableEffect(
    (_signal) => {
      setFleetErr('')
      void amrFleetProxy('jobQuery', { jobCode: '' })
        .then((data) => {
          setFleetPayload(data)
          setFleetErr('')
        })
        .catch((e) => {
          if (isAbortLikeError(e)) return
          setFleetPayload(null)
          setFleetErr('Could not load fleet job list')
        })
        .finally(() => setFleetHydrated(true))
    },
    [seqFleet]
  )

  useEffect(() => {
    const t = setInterval(() => setSeqApp((n) => n + 1), pollMsWorker)
    return () => clearInterval(t)
  }, [pollMsWorker])

  useEffect(() => {
    const t = setInterval(() => setSeqFleet((n) => n + 1), pollMsMissionsInterval)
    return () => clearInterval(t)
  }, [pollMsMissionsInterval])

  /** Banner deep-link: `?multistopSummary=<uuid>` (legacy `openSession`) opens multi-stop overview; fallback = full detail. */
  useEffect(() => {
    if (!multistopSummaryParam || !appHydrated) return
    const sid = multistopSummaryParam.trim()
    const recent = filterAppMissionsRecentOrLive(rows)
    const expanded = expandMultistopSessionsForRecentWindow(rows, recent)
    const groups = groupMissionRecords(expanded)
    const ms = findMultistopGroupBySessionId(groups, sid)
    const stripSummaryParams = () =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('multistopSummary')
          next.delete('openSession')
          return next
        },
        { replace: true }
      )
    if (ms) {
      setMultistopSummarySessionId(sid)
      stripSummaryParams()
      return
    }
    const head = headMissionRecordForSession(rows, sid)
    if (head) {
      setDetailMission(head)
      stripSummaryParams()
      return
    }
    /** Keep `multistopSummary` until rows include this session (e.g. right after Create and show). */
  }, [multistopSummaryParam, rows, appHydrated, setSearchParams])

  const fleetJobsAll = useMemo(() => fleetJobsFromResponse(fleetPayload), [fleetPayload])

  /** Recent-by-created_at plus still-live missions (open worker / open multistop session); full `rows` for fleet dedup. */
  const rowsRecent = useMemo(() => filterAppMissionsRecentOrLive(rows), [rows])

  const rowsRecentExpanded = useMemo(
    () => expandMultistopSessionsForRecentWindow(rows, rowsRecent),
    [rows, rowsRecent]
  )

  const appGroupsBeforeHide = useMemo(
    () => groupMissionRecords(rowsRecentExpanded),
    [rowsRecentExpanded]
  )

  /** In-flight multistop + active singles → top table; terminal/finalized/completed → mission history. */
  const { active: activeMissionGroups, history: historyGroupsBeforeHide } = useMemo(
    () => partitionMissionGroupsForTables(appGroupsBeforeHide),
    [appGroupsBeforeHide]
  )

  /** Mission history: optional time-based hide for fleet-complete rows (see “Fleet-complete hide after” in table footer). */
  const appMissionGroupsAfterStaleRule = useMemo(
    () => filterGroupedMissionsHideStale(historyGroupsBeforeHide, hideFleetCompleteAfterMinutes),
    [historyGroupsBeforeHide, hideFleetCompleteAfterMinutes]
  )

  const appTableGroups = appMissionGroupsAfterStaleRule

  const trackedJobCodes = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      const c = String(r.job_code ?? '').trim()
      if (c) s.add(c)
    }
    return s
  }, [rows])

  const externalFleetJobs = useMemo(() => {
    const seen = new Set<string>()
    const out: Record<string, unknown>[] = []
    for (const j of fleetJobsAll) {
      const code = String(j.jobCode ?? '').trim()
      if (!code || trackedJobCodes.has(code)) continue
      if (seen.has(code)) continue
      seen.add(code)
      out.push(j)
    }
    return out
  }, [fleetJobsAll, trackedJobCodes])

  const sortedAppGroups = useMemo(() => {
    const copy = [...appTableGroups]
    copy.sort((a, b) =>
      compareAppMissionGroups(a, b, historyMissionSort.col, historyMissionSort.dir, attentionFirst, attentionSessionIds)
    )
    return copy
  }, [appTableGroups, historyMissionSort, attentionFirst, attentionSessionIds])

  const sortedActiveMissionGroups = useMemo(() => {
    const copy = [...activeMissionGroups]
    copy.sort((a, b) =>
      compareAppMissionGroups(a, b, activeMissionSort.col, activeMissionSort.dir, attentionFirst, attentionSessionIds)
    )
    return copy
  }, [activeMissionGroups, activeMissionSort, attentionFirst, attentionSessionIds])

  /** Modal sync searches both the active table and mission history. */
  const missionGroupsForModalResolve = useMemo(
    () => [...sortedActiveMissionGroups, ...sortedAppGroups],
    [sortedActiveMissionGroups, sortedAppGroups]
  )

  const multistopSummaryGroup = useMemo(
    () =>
      multistopSummarySessionId
        ? findMultistopGroupBySessionId(missionGroupsForModalResolve, multistopSummarySessionId)
        : null,
    [missionGroupsForModalResolve, multistopSummarySessionId]
  )

  useEffect(() => {
    if (!multistopSummarySessionId || !appHydrated) return
    if (findMultistopGroupBySessionId(missionGroupsForModalResolve, multistopSummarySessionId)) return
    setMultistopSummarySessionId(null)
  }, [missionGroupsForModalResolve, multistopSummarySessionId, appHydrated])

  /** Keep open mission detail in sync with polled mission rows (latest leg status, etc.). */
  useEffect(() => {
    if (!detailMission) return
    const next = resolvedMissionDetailRecord(detailMission, missionGroupsForModalResolve)
    if (!next) return
    setDetailMission((prev) => {
      if (!prev) return prev
      if (
        String(prev.last_status) === String(next.last_status) &&
        String(prev.updated_at ?? '') === String(next.updated_at ?? '') &&
        Number(prev.worker_closed) === Number(next.worker_closed) &&
        Number(prev.finalized) === Number(next.finalized)
      ) {
        return prev
      }
      return next
    })
  }, [missionGroupsForModalResolve, detailMission?.id, detailMission?.multistop_session_id])

  const sortedFleetExternal = useMemo(() => {
    const copy = [...externalFleetJobs]
    copy.sort((a, b) => compareFleetJobRows(a, b, fleetSort.col, fleetSort.dir))
    return copy
  }, [externalFleetJobs, fleetSort])

  const appTotalPages = Math.max(1, Math.ceil(sortedAppGroups.length / appPageSize) || 1)
  const fleetTotalPages = Math.max(1, Math.ceil(sortedFleetExternal.length / fleetPageSize) || 1)

  useEffect(() => {
    setAppPage((p) => Math.min(p, appTotalPages))
  }, [appTotalPages])

  useEffect(() => {
    setFleetPage((p) => Math.min(p, fleetTotalPages))
  }, [fleetTotalPages])

  const appPageSafe = Math.min(appPage, appTotalPages)
  const fleetPageSafe = Math.min(fleetPage, fleetTotalPages)

  const pagedAppGroups = useMemo(
    () => paginateSlice(sortedAppGroups, appPageSafe, appPageSize),
    [sortedAppGroups, appPageSafe, appPageSize]
  )

  const pagedFleetJobs = useMemo(
    () => paginateSlice(sortedFleetExternal, fleetPageSafe, fleetPageSize),
    [sortedFleetExternal, fleetPageSafe, fleetPageSize]
  )

  const toggleActiveMissionSort = (col: AppMissionSortCol) => {
    setActiveMissionSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: defaultActiveMissionSortDir(col) }
    )
  }

  const toggleHistoryMissionSort = (col: AppMissionSortCol) => {
    setHistoryMissionSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: defaultHistoryMissionSortDir(col) }
    )
    setAppPage(1)
  }

  const toggleFleetSort = (col: FleetJobSortCol) => {
    setFleetSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: defaultFleetJobSortDir(col) }
    )
    setFleetPage(1)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Missions</h1>
        </div>
        <button
          type="button"
          className="min-h-[44px] shrink-0 rounded-lg border border-border px-4 text-sm hover:bg-background"
          onClick={() => {
            setSeqApp((n) => n + 1)
            setSeqFleet((n) => n + 1)
          }}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Active Missions</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-foreground/80">
                      <th className="whitespace-nowrap px-3 py-2 text-base font-medium">Robot</th>
                      <SortableTh
                        label="Job / mission code"
                        active={activeMissionSort.col === 'job_code'}
                        dir={activeMissionSort.dir}
                        onClick={() => toggleActiveMissionSort('job_code')}
                      />
                      <SortableTh
                        label="Container"
                        active={activeMissionSort.col === 'container_code'}
                        dir={activeMissionSort.dir}
                        onClick={() => toggleActiveMissionSort('container_code')}
                      />
                      <th className="whitespace-nowrap px-3 py-2 text-xs font-medium">Status</th>
                      <SortableTh
                        label="Created"
                        active={activeMissionSort.col === 'created_at'}
                        dir={activeMissionSort.dir}
                        onClick={() => toggleActiveMissionSort('created_at')}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedActiveMissionGroups.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-foreground/60">
                          No active missions.
                        </td>
                      </tr>
                    ) : (
                      sortedActiveMissionGroups.map((group) => {
                        const r = flattenGroupedMissionRow(group)
                        const created = r.created_at
                        const createdLabel =
                          typeof created === 'string' || created instanceof Date
                            ? formatDateTime(created as string | Date)
                            : String(created ?? '')
                        if (group.kind === 'single') {
                          const headRec = headRecordForMissionDetail(group)
                          const queuedRow = missionRowIsQuietQueueWait(r)
                          const robotLabel =
                            typeof r.locked_robot_id === 'string' && r.locked_robot_id.trim()
                              ? r.locked_robot_id.trim()
                              : '—'
                          return (
                            <tr
                              key={String(r.id)}
                              tabIndex={0}
                              className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                queuedRow ? MISSION_QUEUED_ROW_TABLE_CLASS : ''
                              }`}
                              onClick={() => setDetailMission(headRec)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setDetailMission(headRec)
                                }
                              }}
                            >
                              <td className="px-3 py-2 font-mono text-lg leading-snug text-foreground/90">{robotLabel}</td>
                              <td className="px-3 py-2 font-mono text-xs">
                                <span className="block">{String(r.job_code ?? '')}</span>
                              </td>
                              <td className="px-3 py-2">{String(r.container_code ?? '')}</td>
                              <td className="px-3 py-2">
                                {r.last_status != null ? <MissionJobStatusBadge value={r.last_status} /> : '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-foreground/70">{createdLabel || '—'}</td>
                            </tr>
                          )
                        }
                        const sessionId = String(r.multistop_session_id ?? '').trim()
                        const queuedRow = missionRowIsQuietQueueWait(r)
                        const needsAttention =
                          Boolean(sessionId && attentionSessionIds.has(sessionId)) && !queuedRow
                        const attentionMeta = sessionId ? attentionBySession.get(sessionId) : undefined
                        const sessRaw = multistopSessionStatusFromGroup(group)
                        const waitingForStart = multistopWaitingForFirstSegmentStart(r, attentionMeta ?? null)
                        const robotLabel =
                          typeof r.locked_robot_id === 'string' && r.locked_robot_id.trim()
                            ? r.locked_robot_id.trim()
                            : '—'
                        return (
                          <tr
                            key={String(r.id)}
                            tabIndex={0}
                            title={
                              needsAttention
                                ? 'Needs attention — continue on Mission Overview'
                                : undefined
                            }
                            className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                              needsAttention
                                ? 'border-l-4 border-l-amber-500 bg-amber-500/[0.07]'
                                : queuedRow
                                  ? MISSION_QUEUED_ROW_TABLE_CLASS
                                  : ''
                            }`}
                            onClick={() => setMultistopSummarySessionId(sessionId)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setMultistopSummarySessionId(sessionId)
                              }
                            }}
                          >
                            <td className="px-3 py-2 font-mono text-lg leading-snug text-foreground/90">{robotLabel}</td>
                            <td className="px-3 py-2 font-mono text-xs">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="block">{String(r.job_code ?? '')}</span>
                                {needsAttention ? (
                                  <span className="inline-block rounded bg-amber-500/25 px-1.5 py-0 text-[10px] font-sans font-medium text-amber-900 dark:text-amber-100">
                                    Needs attention
                                  </span>
                                ) : null}
                              </div>
                              <span className="mt-0.5 inline-block rounded bg-primary/15 px-1.5 py-0 text-[10px] font-sans font-medium text-primary">
                                {multistopRouteKindBadgeLabel(group)}
                              </span>
                            </td>
                            <td className="px-3 py-2">{String(r.container_code ?? '')}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  {r.last_status != null ? (
                                    <span
                                      title={
                                        sessRaw
                                          ? `${friendlyMultistopSessionStatus(sessRaw)} · current stop`
                                          : 'Current stop fleet status'
                                      }
                                    >
                                      <MissionJobStatusBadge value={r.last_status} />
                                    </span>
                                  ) : waitingForStart ? (
                                    <span
                                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-left text-xs font-medium text-foreground/85"
                                      title="First leg has not started — open Mission Overview to continue or wait for auto-release"
                                    >
                                      Waiting for start
                                    </span>
                                  ) : sessRaw ? (
                                    <span
                                      title={friendlyMultistopSessionStatus(sessRaw)}
                                      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-left text-xs font-medium ${missionJobStatusChipClass(
                                        multistopSessionWorkflowChipCode(sessRaw)
                                      )}`}
                                    >
                                      <span className="min-w-0 truncate">
                                        {friendlyMultistopSessionStatus(sessRaw)}
                                      </span>
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </div>
                                <AmrMissionCardAutoContinue
                                  continueNotBeforeIso={attentionMeta?.continueNotBefore ?? null}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-foreground/70">{createdLabel || '—'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Mission History</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-foreground/80">
                      <SortableTh
                        label="Job / mission code"
                        active={historyMissionSort.col === 'job_code'}
                        dir={historyMissionSort.dir}
                        onClick={() => toggleHistoryMissionSort('job_code')}
                      />
                      <SortableTh
                        label="Container"
                        active={historyMissionSort.col === 'container_code'}
                        dir={historyMissionSort.dir}
                        onClick={() => toggleHistoryMissionSort('container_code')}
                      />
                      <SortableTh
                        label="Last status"
                        active={historyMissionSort.col === 'last_status'}
                        dir={historyMissionSort.dir}
                        onClick={() => toggleHistoryMissionSort('last_status')}
                      />
                      <SortableTh
                        label="Tracking"
                        active={historyMissionSort.col === 'tracking'}
                        dir={historyMissionSort.dir}
                        onClick={() => toggleHistoryMissionSort('tracking')}
                      />
                      <SortableTh
                        label="Created"
                        active={historyMissionSort.col === 'created_at'}
                        dir={historyMissionSort.dir}
                        onClick={() => toggleHistoryMissionSort('created_at')}
                      />
                      <SortableTh
                        label="Time completed"
                        active={historyMissionSort.col === 'time_completed'}
                        dir={historyMissionSort.dir}
                        onClick={() => toggleHistoryMissionSort('time_completed')}
                      />
                    </tr>
                  </thead>
                  <tbody>
                  {pagedAppGroups.map((group) => {
                    const r = flattenGroupedMissionRow(group)
                    const headRec = headRecordForMissionDetail(group)
                    const isMs = group.kind === 'multistop'
                    const sessionId = String(r.multistop_session_id ?? '').trim()
                    const queuedRow = missionRowIsQuietQueueWait(r)
                    const needsAttention =
                      Boolean(sessionId && attentionSessionIds.has(sessionId)) && !queuedRow
                    const attentionMeta = sessionId ? attentionBySession.get(sessionId) : undefined
                    const created = r.created_at
                    const createdLabel =
                      typeof created === 'string' || created instanceof Date
                        ? formatDateTime(created as string | Date)
                        : String(created ?? '')
                    const completedAt = r.updated_at
                    const timeCompletedLabel =
                      typeof completedAt === 'string' || completedAt instanceof Date
                        ? formatDateTime(completedAt as string | Date)
                        : String(completedAt ?? '')
                    return (
                      <tr
                        key={String(r.id)}
                        tabIndex={0}
                        title={
                          needsAttention ? 'Needs attention — open mission and continue' : undefined
                        }
                        className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          needsAttention
                            ? 'border-l-4 border-l-amber-500 bg-amber-500/[0.07]'
                            : queuedRow
                              ? MISSION_QUEUED_ROW_TABLE_CLASS
                              : ''
                        }`}
                        onClick={() => setDetailMission(headRec)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setDetailMission(headRec)
                          }
                        }}
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="block">{String(r.job_code ?? '')}</span>
                            {needsAttention ? (
                              <span className="inline-block rounded bg-amber-500/25 px-1.5 py-0 text-[10px] font-sans font-medium text-amber-900 dark:text-amber-100">
                                Needs attention
                              </span>
                            ) : null}
                          </div>
                          {isMs ? (
                            <span className="mt-0.5 inline-block rounded bg-primary/15 px-1.5 py-0 text-[10px] font-sans font-medium text-primary">
                              {multistopRouteKindBadgeLabel(group)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{String(r.container_code ?? '')}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              {r.last_status != null ? <MissionJobStatusBadge value={r.last_status} /> : '—'}
                            </div>
                            <AmrMissionCardAutoContinue
                              continueNotBeforeIso={attentionMeta?.continueNotBefore ?? null}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-foreground/80">
                          {Number(r.worker_closed) === 1 ? 'Closed' : 'Open'}
                        </td>
                        <td className="px-3 py-2 text-xs text-foreground/70">{createdLabel || '—'}</td>
                        <td className="px-3 py-2 text-xs text-foreground/70">{timeCompletedLabel || '—'}</td>
                      </tr>
                    )
                  })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border/80 bg-muted/30">
                      <td colSpan={6} className="px-3 py-1.5">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <label className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/65">
                            <span className="whitespace-nowrap">Fleet-complete hide after</span>
                            <select
                              className="h-7 max-w-[11rem] rounded-md border border-border bg-background px-2 py-0 text-xs text-foreground"
                              title="Hide missions that are fleet-complete (finalized or status 30 / 31 / 35) after this long since updated_at."
                              value={
                                hideFleetCompleteAfterMinutes == null ? '' : String(hideFleetCompleteAfterMinutes)
                              }
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === '') {
                                  setHideFleetCompleteAfterMinutes(null)
                                  localStorage.setItem(LS_HIDE_FLEET_COMPLETE_AFTER_MIN, JSON.stringify(null))
                                  return
                                }
                                const n = Number(v)
                                if (Number.isFinite(n) && n > 0) {
                                  setHideFleetCompleteAfterMinutes(n)
                                  localStorage.setItem(LS_HIDE_FLEET_COMPLETE_AFTER_MIN, JSON.stringify(n))
                                }
                              }}
                            >
                              <option value="">Don&apos;t hide</option>
                              {HIDE_FLEET_COMPLETE_AFTER_MINUTE_OPTIONS.map((mins) => (
                                <option key={mins} value={String(mins)}>
                                  {labelHideFleetCompleteOption(mins)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <TablePaginationBar
                idPrefix="missions-app"
                page={appPageSafe}
                pageSize={appPageSize}
                total={sortedAppGroups.length}
                onPageChange={setAppPage}
                onPageSizeChange={(n) => {
                  setAppPageSize(n)
                  setAppPage(1)
                }}
              />
              {rows.length === 0 && (
                <p className="p-6 text-center text-sm text-foreground/60">No app missions yet.</p>
              )}
              {rows.length > 0 && rowsRecent.length === 0 && (
                <p className="border-t border-border/80 p-6 text-center text-sm text-foreground/60">
                  No app missions created in the last {APP_MISSION_DISPLAY_MAX_AGE_HOURS} hours.
                </p>
              )}
              {rows.length > 0 &&
                rowsRecent.length > 0 &&
                appTableGroups.length === 0 &&
                appMissionGroupsAfterStaleRule.length === 0 &&
                hideFleetCompleteAfterMinutes != null && (
                  <p className="border-t border-border/80 p-6 text-center text-sm text-foreground/60">
                    Every fleet-complete mission in this window is older than your “hide after” setting — choose a longer
                    time or turn off hiding to see them again.
                  </p>
                )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Fleet-only (external)</h2>
            {fleetErr ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">{fleetErr}</p>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-foreground/80">
                      <SortableTh
                        label="Source"
                        active={fleetSort.col === 'source'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('source')}
                      />
                      <SortableTh
                        label="Job code"
                        active={fleetSort.col === 'jobCode'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('jobCode')}
                      />
                      <SortableTh
                        label="Container"
                        active={fleetSort.col === 'containerCode'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('containerCode')}
                      />
                      <SortableTh
                        label="Status"
                        active={fleetSort.col === 'status'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('status')}
                      />
                      <SortableTh
                        label="Robot"
                        active={fleetSort.col === 'robotId'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('robotId')}
                      />
                      <SortableTh
                        label="Map"
                        active={fleetSort.col === 'mapCode'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('mapCode')}
                      />
                      <SortableTh
                        label="Create time"
                        active={fleetSort.col === 'createTime'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('createTime')}
                      />
                    </tr>
                  </thead>
                  <tbody>
                  {pagedFleetJobs.map((j, idx) => {
                    const code = String(j.jobCode ?? '')
                    const st = j.status
                    const ct = j.createTime
                    const createTimeLabel =
                      typeof ct === 'string' || ct instanceof Date
                        ? formatDateTime(ct as string | Date)
                        : String(ct ?? '')
                    return (
                      <tr
                        key={code || `fleet-${idx}`}
                        tabIndex={0}
                        className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() => setDetailFleetJob(j)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setDetailFleetJob(j)
                          }
                        }}
                      >
                        <td className="px-3 py-2 text-xs">{String(j.source ?? '') || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{code || '—'}</td>
                        <td className="px-3 py-2">{String(j.containerCode ?? '')}</td>
                        <td className="px-3 py-2">
                          {typeof st === 'number' ? <MissionJobStatusBadge value={st} /> : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{String(j.robotId ?? '')}</td>
                        <td className="px-3 py-2 text-xs">{String(j.mapCode ?? '')}</td>
                        <td className="px-3 py-2 text-xs text-foreground/70">
                          {createTimeLabel || '—'}
                        </td>
                      </tr>
                    )
                  })}
                  </tbody>
                </table>
              </div>
              <TablePaginationBar
                idPrefix="missions-fleet"
                page={fleetPageSafe}
                pageSize={fleetPageSize}
                total={sortedFleetExternal.length}
                onPageChange={setFleetPage}
                onPageSizeChange={(n) => {
                  setFleetPageSize(n)
                  setFleetPage(1)
                }}
              />
              {!fleetErr && externalFleetJobs.length === 0 ? (
                <p className="border-t border-border/80 p-6 text-center text-sm text-foreground/60">
                  No fleet-only jobs — every job returned by the fleet is tracked in this app, or the fleet list is empty.
                </p>
              ) : null}
            </div>
          </section>

          {multistopSummaryGroup ? (
            <AmrMultistopSummaryModal
              group={multistopSummaryGroup}
              onClose={() => setMultistopSummarySessionId(null)}
              onSessionUpdated={() => setSeqApp((n) => n + 1)}
              onOpenFullMission={(rec) => setDetailMission(rec)}
            />
          ) : null}
          <AmrMissionDetailModal
            record={detailMission}
            onClose={() => setDetailMission(null)}
            onSessionUpdated={() => setSeqApp((n) => n + 1)}
          />
          <AmrFleetJobDetailModal job={detailFleetJob} onClose={() => setDetailFleetJob(null)} />
        </>
      )}
    </div>
  )
}

export default AmrMissions
