import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, isAbortLikeError } from '@/api/client'
import {
  getAmrMissionAttention,
  getAmrMissionRecords,
  getAmrSettings,
  pollMsAlignedWithMissionWorker,
  type AmrMissionAttentionItem,
} from '@/api/amr'
import { AmrMissionCardAutoContinue } from '@/components/amr/AmrAutoContinueCountdown'
import { AmrMultistopSummaryModal } from '@/components/amr/AmrMultistopSummaryModal'
import { AmrMissionDetailModal } from '@/components/amr/AmrMissionDetailModal'
import { MissionQueueWaitingCell } from '@/components/amr/MissionQueueWaitingCell'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'
import { amrPath } from '@/lib/appPaths'
import { useAmrMissionNewModal } from '@/contexts/AmrMissionNewModalContext'
import { useAbortableEffect } from '@/hooks/useAbortableEffect'
import { APP_MISSION_DISPLAY_MAX_AGE_HOURS, filterAppMissionsRecentOrLive } from '@/utils/amrAppMissions'
import {
  expandMultistopSessionsForRecentWindow,
  filterGroupedMissionsHideStale,
  findMultistopGroupBySessionId,
  flattenGroupedMissionRow,
  friendlyMultistopSessionStatus,
  groupMissionRecords,
  headRecordForMissionDetail,
  multistopRouteKindBadgeLabel,
  multistopSessionStatusFromGroup,
  multistopWaitingForFirstSegmentStart,
  partitionMissionGroupsForTables,
  resolvedMissionDetailRecord,
  type GroupedMissionRow,
} from '@/utils/amrMultistopDisplay'
import { containerEmptyFullFriendly } from '@/utils/amrContainerFleet'
import {
  MISSION_QUEUED_ROW_TABLE_CLASS,
  missionJobStatusFriendly,
  missionRowIsQuietQueueWait,
} from '@/utils/amrMissionJobStatus'
import { robotStatusFriendly } from '@/utils/amrRobotStatus'

type StatusCountRow = { code: number | null; label: string; count: number }

const RECENT_APP_MISSIONS_TABLE_LIMIT = 10

function fleetDataRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const arr = (data as { data?: unknown }).data
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x))
}

function aggregateByFriendly(
  rows: Record<string, unknown>[],
  pick: (r: Record<string, unknown>) => unknown,
  friendly: (raw: unknown) => { label: string; code: number | null }
): StatusCountRow[] {
  const map = new Map<string, StatusCountRow>()
  for (const r of rows) {
    const { label, code } = friendly(pick(r))
    const key = code !== null ? `c:${code}` : `l:${label}`
    const cur = map.get(key)
    if (cur) cur.count += 1
    else map.set(key, { code, label, count: 1 })
  }
  const out = [...map.values()]
  out.sort((a, b) => {
    if (a.code === null) return 1
    if (b.code === null) return -1
    return a.code - b.code
  })
  return out
}

export function AmrDashboard() {
  const amrNewMissionModal = useAmrMissionNewModal()
  const [records, setRecords] = useState<Record<string, unknown>[]>([])
  const [jobQueryRows, setJobQueryRows] = useState<Record<string, unknown>[] | null>(null)
  const [robotQueryRows, setRobotQueryRows] = useState<Record<string, unknown>[] | null>(null)
  const [containerQueryRows, setContainerQueryRows] = useState<Record<string, unknown>[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [seq, setSeq] = useState(0)
  const [pollMs, setPollMs] = useState(5000)
  const [detailMission, setDetailMission] = useState<Record<string, unknown> | null>(null)
  const [multistopSummarySessionId, setMultistopSummarySessionId] = useState<string | null>(null)
  const [attentionBySession, setAttentionBySession] = useState(
    () => new Map<string, AmrMissionAttentionItem>()
  )
  const attentionSessionIds = useMemo(() => new Set(attentionBySession.keys()), [attentionBySession])

  useEffect(() => {
    void getAmrSettings().then((s) => setPollMs(pollMsAlignedWithMissionWorker(s)))
  }, [])

  useEffect(() => {
    const t = setInterval(() => setSeq((n) => n + 1), pollMs)
    return () => clearInterval(t)
  }, [pollMs])

  useAbortableEffect(
    (signal) => {
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
      void Promise.all([
        getAmrMissionRecords({ signal }).then((r) => setRecords(r)),
        api
          .post<unknown>('/amr/dc/fleet', { operation: 'jobQuery', payload: { jobCode: '' } }, { signal })
          .then((res) => setJobQueryRows(fleetDataRows(res.data)))
          .catch((e) => {
            if (isAbortLikeError(e)) return
            setJobQueryRows(null)
          }),
        api
          .post<unknown>(
            '/amr/dc/fleet',
            { operation: 'robotQuery', payload: { robotId: '', robotType: '' } },
            { signal }
          )
          .then((res) => setRobotQueryRows(fleetDataRows(res.data)))
          .catch((e) => {
            if (isAbortLikeError(e)) return
            setRobotQueryRows(null)
          }),
        api
          .post<unknown>(
            '/amr/dc/fleet',
            {
              operation: 'containerQueryAll',
              payload: { containerCode: '', nodeCode: '', inMapStatus: '1' },
            },
            { signal }
          )
          .then((res) => setContainerQueryRows(fleetDataRows(res.data)))
          .catch((e) => {
            if (isAbortLikeError(e)) return
            setContainerQueryRows(null)
          }),
      ])
        .catch((e) => {
          if (!isAbortLikeError(e)) console.warn(e)
        })
        .finally(() => setLoading(false))
    },
    [seq]
  )

  const recentExpanded = useMemo(
    () => expandMultistopSessionsForRecentWindow(records, filterAppMissionsRecentOrLive(records)),
    [records]
  )

  const { active: activeMissionGroups, history: historyGroupsRest } = useMemo(
    () => partitionMissionGroupsForTables(groupMissionRecords(recentExpanded)),
    [recentExpanded]
  )

  /** Same ordering as Missions → Active: attention rows first, then oldest created first. */
  const sortedActiveMissionGroups = useMemo(() => {
    const copy = [...activeMissionGroups]
    copy.sort((a, b) => {
      const fa = flattenGroupedMissionRow(a)
      const fb = flattenGroupedMissionRow(b)
      const sa = String(fa.multistop_session_id ?? '').trim()
      const sb = String(fb.multistop_session_id ?? '').trim()
      const aa =
        Boolean(sa && attentionSessionIds.has(sa)) && !missionRowIsQuietQueueWait(fa)
      const bb =
        Boolean(sb && attentionSessionIds.has(sb)) && !missionRowIsQuietQueueWait(fb)
      if (aa !== bb) return aa ? -1 : 1
      return String(fa.created_at ?? '').localeCompare(String(fb.created_at ?? ''))
    })
    return copy
  }, [activeMissionGroups, attentionSessionIds])

  const recentGroups = useMemo(
    () => filterGroupedMissionsHideStale(historyGroupsRest, null),
    [historyGroupsRest]
  )

  const missionGroupsForModalResolve = useMemo(
    (): GroupedMissionRow[] => [...activeMissionGroups, ...recentGroups],
    [activeMissionGroups, recentGroups]
  )

  const multistopSummaryGroup = useMemo(
    () =>
      multistopSummarySessionId
        ? findMultistopGroupBySessionId(missionGroupsForModalResolve, multistopSummarySessionId)
        : null,
    [missionGroupsForModalResolve, multistopSummarySessionId]
  )

  useEffect(() => {
    if (!multistopSummarySessionId || loading) return
    if (findMultistopGroupBySessionId(missionGroupsForModalResolve, multistopSummarySessionId)) return
    setMultistopSummarySessionId(null)
  }, [missionGroupsForModalResolve, multistopSummarySessionId, loading])

  /** Keep open mission detail in sync with polled mission rows (latest leg status). */
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

  const recentFlattened = useMemo(
    () => [...activeMissionGroups, ...recentGroups].map((gr) => flattenGroupedMissionRow(gr)),
    [activeMissionGroups, recentGroups]
  )

  const recentTableGroups = useMemo(() => {
    const pairs = recentGroups.map((g) => ({ g, f: flattenGroupedMissionRow(g) }))
    pairs.sort((a, b) => String(b.f.created_at ?? '').localeCompare(String(a.f.created_at ?? '')))
    return pairs.slice(0, RECENT_APP_MISSIONS_TABLE_LIMIT).map((p) => p.g)
  }, [recentGroups])

  const appMissionStatusRows = useMemo(
    () => aggregateByFriendly(recentFlattened, (r) => r.last_status, missionJobStatusFriendly),
    [recentFlattened]
  )

  const fleetJobStatusRows = useMemo(() => {
    if (!jobQueryRows) return []
    return aggregateByFriendly(jobQueryRows, (r) => r.status, missionJobStatusFriendly)
  }, [jobQueryRows])

  const robotStatusRows = useMemo(() => {
    if (!robotQueryRows) return []
    return aggregateByFriendly(robotQueryRows, (r) => r.status, robotStatusFriendly)
  }, [robotQueryRows])

  const containerLoadRows = useMemo(() => {
    if (!containerQueryRows) return []
    return aggregateByFriendly(containerQueryRows, (r) => r.emptyFullStatus ?? r.empty_full_status, containerEmptyFullFriendly)
  }, [containerQueryRows])

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">AMR dashboard</h1>
          <p className="mt-1 break-words text-sm text-foreground/70">
            Tiles show totals with a breakdown by fleet status (same queries as the Missions, Robots, and Containers
            pages). App missions and the table below use only creations from the last {APP_MISSION_DISPLAY_MAX_AGE_HOURS}{' '}
            hours. This page auto-refreshes on the mission worker interval (AMR settings).
          </p>
        </div>
        <button
          type="button"
          className="min-h-[44px] shrink-0 rounded-lg border border-border px-4 text-sm hover:bg-background"
          onClick={() => setSeq((n) => n + 1)}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <FleetBreakdownCard
            title="App missions"
            total={recentFlattened.length}
            rows={appMissionStatusRows}
            to={amrPath('missions')}
          />
          <FleetBreakdownCard
            title="Fleet jobs"
            total={jobQueryRows?.length ?? null}
            rows={fleetJobStatusRows}
            to={amrPath('missions')}
            unavailable={jobQueryRows === null}
          />
          <FleetBreakdownCard
            title="Robots"
            total={robotQueryRows?.length ?? null}
            rows={robotStatusRows}
            to={amrPath('robots')}
            unavailable={robotQueryRows === null}
          />
          <FleetBreakdownCard
            title="Containers in map"
            total={containerQueryRows?.length ?? null}
            rows={containerLoadRows}
            to={amrPath('containers')}
            unavailable={containerQueryRows === null}
          />
        </div>
      )}

      <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
        <h2 className="text-sm font-medium text-foreground">Active missions</h2>
        <p className="mt-1 text-xs text-foreground/65">
          In-progress app missions (single-stop or multi-stop) — same list as on Missions.
        </p>
        <div className="mt-3 max-w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[min(100%,28rem)] text-left text-sm md:min-w-[28rem]">
            <thead>
              <tr className="border-b border-border text-foreground/70">
                <th className="py-2 pr-3 text-base font-medium">Robot</th>
                <th className="py-2 pr-3 font-medium">Job code</th>
                <th className="py-2 pr-3 font-medium">Session</th>
                <th className="max-w-[11rem] py-2 pr-3 text-xs font-medium leading-tight">Queue / waiting</th>
                <th className="py-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedActiveMissionGroups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-foreground/60">
                    No active missions.
                  </td>
                </tr>
              ) : (
                sortedActiveMissionGroups.map((group) => {
                  const r = flattenGroupedMissionRow(group)
                  const sessionId = String(r.multistop_session_id ?? '').trim()
                  const att = sessionId ? attentionBySession.get(sessionId) : undefined
                  const queuedRow = missionRowIsQuietQueueWait(r)
                  const robotLabel =
                    typeof r.locked_robot_id === 'string' && r.locked_robot_id.trim()
                      ? r.locked_robot_id.trim()
                      : '—'
                  if (group.kind === 'single') {
                    const headRec = headRecordForMissionDetail(group)
                    return (
                      <tr
                        key={String(r.id)}
                        tabIndex={0}
                        className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-background/80 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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
                      <td className="py-2 pr-3 font-mono text-lg leading-snug text-foreground/90">{robotLabel}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{String(r.job_code ?? '')}</td>
                      <td className="py-2 pr-3 text-xs text-foreground/70">—</td>
                      <td className="max-w-[12rem] py-2 pr-3 align-top text-xs">
                        <MissionQueueWaitingCell flat={r} />
                      </td>
                        <td className="py-2 pr-3">
                          {r.last_status != null ? <MissionJobStatusBadge value={r.last_status} /> : '—'}
                        </td>
                      </tr>
                    )
                  }
                  const sess = multistopSessionStatusFromGroup(group)
                  const waitingForStart = multistopWaitingForFirstSegmentStart(r, att ?? null)
                  return (
                    <tr
                      key={String(r.id)}
                      tabIndex={0}
                      className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-background/80 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        queuedRow ? MISSION_QUEUED_ROW_TABLE_CLASS : ''
                      }`}
                      onClick={() => sessionId && setMultistopSummarySessionId(sessionId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          if (sessionId) setMultistopSummarySessionId(sessionId)
                        }
                      }}
                    >
                      <td className="py-2 pr-3 font-mono text-lg leading-snug text-foreground/90">{robotLabel}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{String(r.job_code ?? '')}</td>
                      <td className="py-2 pr-3 text-xs text-foreground/80">
                        <span className="block">{sess ? friendlyMultistopSessionStatus(sess) : '—'}</span>
                      </td>
                      <td className="max-w-[12rem] py-2 pr-3 align-top text-xs">
                        <MissionQueueWaitingCell flat={r} />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            {r.last_status != null ? (
                              <MissionJobStatusBadge value={r.last_status} />
                            ) : waitingForStart ? (
                              <span
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-left text-xs font-medium text-foreground/85"
                                title="First leg has not started — open Mission Overview to continue or wait for auto-release"
                              >
                                Waiting for start
                              </span>
                            ) : (
                              '—'
                            )}
                          </div>
                          <AmrMissionCardAutoContinue
                            continueNotBeforeIso={att?.continueNotBefore ?? null}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">Recent app missions</h2>
          </div>
          <Link className="shrink-0 text-sm text-primary hover:underline" to={amrPath('missions')}>
            View all
          </Link>
        </div>
        <div className="max-w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[min(100%,36rem)] text-left text-sm md:min-w-[36rem]">
            <thead>
              <tr className="border-b border-border text-foreground/70">
                <th className="py-2 pr-3 font-medium">Job code</th>
                <th className="py-2 pr-3 font-medium">Container</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Tracking</th>
                <th className="py-2 font-medium">Fleet complete</th>
              </tr>
            </thead>
            <tbody>
              {recentTableGroups.map((group) => {
                const r = flattenGroupedMissionRow(group)
                const headRec = headRecordForMissionDetail(group)
                const sessionId = String(r.multistop_session_id ?? '').trim()
                const queuedRow = missionRowIsQuietQueueWait(r)
                const needsAttention =
                  Boolean(sessionId && attentionSessionIds.has(sessionId)) && !queuedRow
                const attentionMeta = sessionId ? attentionBySession.get(sessionId) : undefined
                return (
                  <tr
                    key={String(r.id)}
                    tabIndex={0}
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
                    <td className="py-2 pr-3 font-mono text-xs">
                      <span className="block">{String(r.job_code ?? '')}</span>
                      {group.kind === 'multistop' ? (
                        <span className="mt-0.5 inline-block text-[10px] font-sans font-medium text-primary">
                          {multistopRouteKindBadgeLabel(group)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{String(r.container_code ?? '')}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          {r.last_status != null ? <MissionJobStatusBadge value={r.last_status} /> : '—'}
                        </div>
                        <AmrMissionCardAutoContinue
                          continueNotBeforeIso={attentionMeta?.continueNotBefore ?? null}
                        />
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-foreground/80">
                      {Number(r.worker_closed) === 1 ? 'Closed' : 'Open'}
                    </td>
                    <td className="py-2">{Number(r.finalized) === 1 ? 'Yes' : 'No'}</td>
                  </tr>
                )
              })}
              {recentTableGroups.length === 0 && records.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-foreground/60">
                    No missions yet.{' '}
                    {amrNewMissionModal ? (
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => amrNewMissionModal.openNewMission()}
                      >
                        Create one
                      </button>
                    ) : (
                      <Link className="text-primary underline" to={amrPath('missions/new')}>
                        Create one
                      </Link>
                    )}
                  </td>
                </tr>
              )}
              {recentTableGroups.length === 0 &&
                records.length > 0 &&
                filterAppMissionsRecentOrLive(records).length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-foreground/60">
                      No missions in the last {APP_MISSION_DISPLAY_MAX_AGE_HOURS} hours (and none still open).
                    </td>
                  </tr>
                )}
              {recentTableGroups.length === 0 &&
                records.length > 0 &&
                filterAppMissionsRecentOrLive(records).length > 0 &&
                sortedActiveMissionGroups.length > 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-foreground/60">
                      No mission history in this table — active missions are listed above.
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </div>

      {multistopSummaryGroup ? (
        <AmrMultistopSummaryModal
          group={multistopSummaryGroup}
          onClose={() => setMultistopSummarySessionId(null)}
          onSessionUpdated={() => setSeq((n) => n + 1)}
          onOpenFullMission={(rec) => setDetailMission(rec)}
        />
      ) : null}
      <AmrMissionDetailModal
        record={detailMission}
        onClose={() => setDetailMission(null)}
        onSessionUpdated={() => setSeq((n) => n + 1)}
      />
    </div>
  )
}

function FleetBreakdownCard({
  title,
  total,
  rows,
  to,
  unavailable,
}: {
  title: string
  total: number | null
  rows: StatusCountRow[]
  to: string
  unavailable?: boolean
}) {
  return (
    <Link
      to={to}
      className="block min-w-0 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-background"
    >
      <div className="break-words text-xs font-medium uppercase leading-snug tracking-wide text-foreground/60">
        {title}
      </div>
      {unavailable || total === null ? (
        <>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground/50">—</p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Fleet data unavailable</p>
        </>
      ) : (
        <>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{total}</div>
          {total > 0 && rows.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-border/80 pt-3">
              {rows.map((row) => (
                <li
                  key={row.code === null ? `n-${row.label}` : String(row.code)}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 text-foreground/85">{row.label}</span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">{row.count}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Link>
  )
}

export default AmrDashboard
