import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { getAmrFleetApiLog, getAmrMissionLog } from '@/api/amr'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'
import {
  paginateSlice,
  SortableTh,
  TablePaginationBar,
  type SortDir,
} from '@/components/amr/AmrTablePagination'
import { useAbortableEffect } from '@/hooks/useAbortableEffect'
import { isAbortLikeError } from '@/api/client'
import { MISSION_JOB_STATUS_NAMES } from '@/utils/amrMissionJobStatus'
import { compareRecordedAtStrings } from '@/utils/amrLogRecordedAt'

/** Pretty-print JSON for display; strings are parsed when valid JSON. */
function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t) return ''
    try {
      return JSON.stringify(JSON.parse(t), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Whitespace-separated terms; a row matches if **any** term appears in the row blob.
 * Deep links pass `jobCode sessionId` — OR keeps mission rows that only have the job, and fleet rows that only mention the session in JSON.
 */
function searchQueryTokens(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

function missionRowMatchesSearch(e: Record<string, unknown>, q: string): boolean {
  const tokens = searchQueryTokens(q)
  if (tokens.length === 0) return true
  const blob = [e.mission_record_id, e.recorded_at, e.job_code, e.job_status, e.raw_json]
    .map((x) => String(x ?? ''))
    .join('\u0001')
    .toLowerCase()
  return tokens.some((t) => blob.includes(t))
}

function fleetRowMatchesSearch(e: Record<string, unknown>, q: string): boolean {
  const tokens = searchQueryTokens(q)
  if (tokens.length === 0) return true
  const blob = [
    e.mission_record_id,
    e.recorded_at,
    e.source,
    e.job_code,
    e.operation,
    e.http_status,
    e.request_json,
    e.response_json,
    e.user_username,
  ]
    .map((x) => String(x ?? ''))
    .join('\u0001')
    .toLowerCase()
  return tokens.some((t) => blob.includes(t))
}

const FLEET_SOURCES = [
  'fleet-proxy',
  'fleet-test',
  'rack-move',
  'multistop-start',
  'multistop-continue',
  'mission-worker',
] as const

type MissionSortCol = 'recorded_at' | 'job_code' | 'job_status'

type FleetSortCol = 'recorded_at' | 'source' | 'job_code' | 'operation' | 'http_status'

function defaultMissionSortDir(col: MissionSortCol): SortDir {
  return col === 'job_code' ? 'asc' : 'desc'
}

function defaultFleetSortDir(col: FleetSortCol): SortDir {
  if (col === 'source' || col === 'job_code' || col === 'operation') return 'asc'
  return 'desc'
}

function compareMissionRows(a: Record<string, unknown>, b: Record<string, unknown>, col: MissionSortCol, dir: SortDir): number {
  const m = dir === 'asc' ? 1 : -1
  if (col === 'recorded_at') {
    return compareRecordedAtStrings(a.recorded_at, b.recorded_at) * m
  }
  if (col === 'job_code') {
    return String(a.job_code ?? '').localeCompare(String(b.job_code ?? ''), undefined, { sensitivity: 'base' }) * m
  }
  const na = Number(a.job_status)
  const nb = Number(b.job_status)
  const va = Number.isFinite(na) ? na : Number.NEGATIVE_INFINITY
  const vb = Number.isFinite(nb) ? nb : Number.NEGATIVE_INFINITY
  return (va - vb) * m
}

function compareFleetRows(a: Record<string, unknown>, b: Record<string, unknown>, col: FleetSortCol, dir: SortDir): number {
  const m = dir === 'asc' ? 1 : -1
  if (col === 'recorded_at') {
    return compareRecordedAtStrings(a.recorded_at, b.recorded_at) * m
  }
  if (col === 'source') {
    return String(a.source ?? '').localeCompare(String(b.source ?? ''), undefined, { sensitivity: 'base' }) * m
  }
  if (col === 'job_code') {
    return String(a.job_code ?? '').localeCompare(String(b.job_code ?? ''), undefined, { sensitivity: 'base' }) * m
  }
  if (col === 'operation') {
    return String(a.operation ?? '').localeCompare(String(b.operation ?? ''), undefined, { sensitivity: 'base' }) * m
  }
  const na = Number(a.http_status)
  const nb = Number(b.http_status)
  const va = Number.isFinite(na) ? na : Number.NEGATIVE_INFINITY
  const vb = Number.isFinite(nb) ? nb : Number.NEGATIVE_INFINITY
  return (va - vb) * m
}

type LogDetailModal =
  | null
  | { kind: 'mission'; row: Record<string, unknown> }
  | { kind: 'fleet'; row: Record<string, unknown> }

export function AmrLogs() {
  const [searchParams] = useSearchParams()

  /** From mission detail link — scope logs to one mission record (fleet API calls tagged with that id). */
  const missionRecordIdFilter = useMemo(() => {
    const raw =
      searchParams.get('missionRecordId') ?? searchParams.get('recordId') ?? searchParams.get('mr')
    const s = typeof raw === 'string' ? raw.trim() : ''
    return s.length > 0 ? s : null
  }, [searchParams])

  const [missionEntries, setMissionEntries] = useState<Record<string, unknown>[]>([])
  const [fleetEntries, setFleetEntries] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [seq, setSeq] = useState(0)

  const [missionSearch, setMissionSearch] = useState('')
  const [missionStatusFilter, setMissionStatusFilter] = useState<string>('')
  const [fleetSearch, setFleetSearch] = useState('')
  const [fleetSourceFilter, setFleetSourceFilter] = useState<string>('')
  const [fleetOperationFilter, setFleetOperationFilter] = useState<string>('')
  const [fleetHttpFilter, setFleetHttpFilter] = useState<string>('')

  const [missionSort, setMissionSort] = useState<{ col: MissionSortCol; dir: SortDir }>({
    col: 'recorded_at',
    dir: 'desc',
  })
  const [fleetSort, setFleetSort] = useState<{ col: FleetSortCol; dir: SortDir }>({
    col: 'recorded_at',
    dir: 'desc',
  })
  const [missionPage, setMissionPage] = useState(1)
  const [missionPageSize, setMissionPageSize] = useState(25)
  const [fleetPage, setFleetPage] = useState(1)
  const [fleetPageSize, setFleetPageSize] = useState(25)

  const [detailModal, setDetailModal] = useState<LogDetailModal>(null)

  /** e.g. mission detail: `?missionRecordId=…&q=…` — search seeds mission table; fleet is scoped by id only */
  useEffect(() => {
    const raw = searchParams.get('q') ?? searchParams.get('job') ?? searchParams.get('jobCode')
    const q = typeof raw === 'string' ? raw.trim() : ''
    const hasMr = Boolean(missionRecordIdFilter)
    if (q) setMissionSearch(q)
    if (hasMr) setFleetSearch('')
    else if (q) setFleetSearch(q)
  }, [searchParams, missionRecordIdFilter])

  useEffect(() => {
    if (!detailModal) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setDetailModal(null)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [detailModal])

  useAbortableEffect(
    (signal) => {
      // Like Missions: do not set loading on Refresh — only initial `loading` shows the skeleton.
      void Promise.all([getAmrMissionLog({ signal }), getAmrFleetApiLog({ signal })])
        .then(([m, f]) => {
          setMissionEntries(m)
          setFleetEntries(f)
        })
        .catch((e) => {
          if (!isAbortLikeError(e)) console.warn(e)
        })
        .finally(() => setLoading(false))
    },
    [seq]
  )

  const fleetHttpOptions = useMemo(() => {
    const set = new Set<string>()
    for (const e of fleetEntries) {
      const h = e.http_status
      if (h != null && h !== '') set.add(String(h))
    }
    return [...set].sort((a, b) => Number(a) - Number(b))
  }, [fleetEntries])

  const fleetOperationOptions = useMemo(() => {
    const set = new Set<string>()
    for (const e of fleetEntries) {
      const op = e.operation
      if (op != null && String(op).trim() !== '') set.add(String(op))
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [fleetEntries])

  const filteredMission = useMemo(() => {
    let rows = missionEntries
    if (missionRecordIdFilter) {
      rows = rows.filter((e) => String(e.mission_record_id ?? '') === missionRecordIdFilter)
    }
    if (missionStatusFilter !== '') {
      const code = Number(missionStatusFilter)
      rows = rows.filter((e) => Number(e.job_status) === code)
    }
    if (missionSearch.trim()) {
      rows = rows.filter((e) => missionRowMatchesSearch(e, missionSearch))
    }
    return rows
  }, [missionEntries, missionRecordIdFilter, missionSearch, missionStatusFilter])

  const filteredFleet = useMemo(() => {
    let rows = fleetEntries
    if (missionRecordIdFilter) {
      rows = rows.filter((e) => String(e.mission_record_id ?? '') === missionRecordIdFilter)
    }
    if (fleetSourceFilter !== '') {
      rows = rows.filter((e) => String(e.source ?? '') === fleetSourceFilter)
    }
    if (fleetOperationFilter !== '') {
      rows = rows.filter((e) => String(e.operation ?? '') === fleetOperationFilter)
    }
    if (fleetHttpFilter !== '') {
      rows = rows.filter((e) => String(e.http_status ?? '') === fleetHttpFilter)
    }
    if (fleetSearch.trim()) {
      rows = rows.filter((e) => fleetRowMatchesSearch(e, fleetSearch))
    }
    return rows
  }, [fleetEntries, fleetSearch, fleetSourceFilter, fleetOperationFilter, fleetHttpFilter, missionRecordIdFilter])

  const sortedMission = useMemo(() => {
    const rows = [...filteredMission]
    rows.sort((a, b) => compareMissionRows(a, b, missionSort.col, missionSort.dir))
    return rows
  }, [filteredMission, missionSort])

  const sortedFleet = useMemo(() => {
    const rows = [...filteredFleet]
    rows.sort((a, b) => compareFleetRows(a, b, fleetSort.col, fleetSort.dir))
    return rows
  }, [filteredFleet, fleetSort])

  const missionTotalPages = Math.max(1, Math.ceil(sortedMission.length / missionPageSize) || 1)
  const fleetTotalPages = Math.max(1, Math.ceil(sortedFleet.length / fleetPageSize) || 1)

  useEffect(() => {
    setMissionPage((p) => Math.min(p, missionTotalPages))
  }, [missionTotalPages])

  useEffect(() => {
    setFleetPage((p) => Math.min(p, fleetTotalPages))
  }, [fleetTotalPages])

  useEffect(() => {
    setMissionPage(1)
  }, [missionSearch, missionStatusFilter, missionRecordIdFilter])

  useEffect(() => {
    setFleetPage(1)
  }, [fleetSearch, fleetSourceFilter, fleetOperationFilter, fleetHttpFilter, missionRecordIdFilter])

  const missionPageSafe = Math.min(missionPage, missionTotalPages)
  const fleetPageSafe = Math.min(fleetPage, fleetTotalPages)

  const pagedMission = useMemo(
    () => paginateSlice(sortedMission, missionPageSafe, missionPageSize),
    [sortedMission, missionPageSafe, missionPageSize]
  )

  const pagedFleet = useMemo(
    () => paginateSlice(sortedFleet, fleetPageSafe, fleetPageSize),
    [sortedFleet, fleetPageSafe, fleetPageSize]
  )

  const toggleMissionSort = (col: MissionSortCol) => {
    setMissionSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: defaultMissionSortDir(col) }
    )
    setMissionPage(1)
  }

  const toggleFleetSort = (col: FleetSortCol) => {
    setFleetSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: defaultFleetSortDir(col) }
    )
    setFleetPage(1)
  }

  const rowInteractive =
    'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

  return (
    <div className="relative isolate mx-auto max-w-6xl space-y-8">
      <div className="relative sticky top-0 z-40 mb-2 border-b border-border bg-background py-3 shadow-sm">
        {/* Covers main’s top padding so scrolled rows cannot show through above the bar */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-2 h-2 bg-background sm:-top-3 sm:h-3"
        />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Logs</h1>
            <p className="mt-1 text-sm text-foreground/70">
              Mission status history from the monitor, and outbound fleet API calls — separate tables.               Timestamps include milliseconds so rapid entries stay in send order when sorting. Times use the application
              server’s local timezone.
            </p>
          </div>
          <button
            type="button"
            className="min-h-[44px] shrink-0 rounded-lg border border-border px-4 text-sm"
            onClick={() => setSeq((n) => n + 1)}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <>
          <section className="relative z-0 space-y-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Mission status log</h2>
            <p className="text-xs text-foreground/60">
              Append-only job status updates from the server mission worker (<code className="text-[11px]">jobQuery</code>{' '}
              snapshots). Click a row for formatted payload JSON.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-medium text-foreground/70">
                Search
                <input
                  type="search"
                  value={missionSearch}
                  onChange={(e) => setMissionSearch(e.target.value)}
                  placeholder="Job, time, status, payload…"
                  className="min-h-[40px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40"
                  autoComplete="off"
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-xs font-medium text-foreground/70 sm:w-52">
                Status
                <select
                  value={missionStatusFilter}
                  onChange={(e) => setMissionStatusFilter(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All statuses</option>
                  {Object.entries(MISSION_JOB_STATUS_NAMES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} — {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-foreground/55">
              <span className="tabular-nums font-medium text-foreground/80">{filteredMission.length}</span> of{' '}
              <span className="tabular-nums">{missionEntries.length}</span> entries match filters — click column headers
              to sort; paginate below.
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <SortableTh
                        label="Time"
                        active={missionSort.col === 'recorded_at'}
                        dir={missionSort.dir}
                        onClick={() => toggleMissionSort('recorded_at')}
                      />
                      <SortableTh
                        label="Job"
                        active={missionSort.col === 'job_code'}
                        dir={missionSort.dir}
                        onClick={() => toggleMissionSort('job_code')}
                      />
                      <SortableTh
                        label="Status"
                        active={missionSort.col === 'job_status'}
                        dir={missionSort.dir}
                        onClick={() => toggleMissionSort('job_status')}
                      />
                    </tr>
                  </thead>
                  <tbody>
                  {pagedMission.map((e) => (
                    <tr
                      key={String(e.id)}
                      tabIndex={0}
                      className={`border-b border-border/60 align-top ${rowInteractive}`}
                      onClick={() => setDetailModal({ kind: 'mission', row: e })}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault()
                          setDetailModal({ kind: 'mission', row: e })
                        }
                      }}
                    >
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{String(e.recorded_at ?? '')}</td>
                      <td className="px-3 py-2 font-mono text-xs">{String(e.job_code ?? '')}</td>
                      <td className="px-3 py-2">
                        {e.job_status != null ? <MissionJobStatusBadge value={e.job_status} /> : '—'}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
              <TablePaginationBar
                idPrefix="mission-log"
                page={missionPageSafe}
                pageSize={missionPageSize}
                total={sortedMission.length}
                onPageChange={setMissionPage}
                onPageSizeChange={(n) => {
                  setMissionPageSize(n)
                  setMissionPage(1)
                }}
              />
              {missionEntries.length === 0 ? (
                <p className="border-t border-border/80 p-6 text-center text-sm text-foreground/60">
                  No mission status entries yet.
                </p>
              ) : filteredMission.length === 0 ? (
                <p className="border-t border-border/80 p-6 text-center text-sm text-foreground/60">
                  No rows match the current search and filters.
                </p>
              ) : null}
            </div>
          </section>

          <section className="relative z-0 space-y-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Fleet API log</h2>
            <p className="text-xs text-foreground/60">
              Every outbound fleet POST recorded by the server (proxy, rack-move, mission worker). Click a row for
              request/response JSON.
            </p>
            {missionRecordIdFilter ? (
              <p className="text-xs text-foreground/75">
                Filtered to calls logged for mission record{' '}
                <span className="break-all font-mono text-[11px] text-foreground">{missionRecordIdFilter}</span>{' '}
                only (other fleet traffic is hidden).
              </p>
            ) : null}
            <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-medium text-foreground/70">
                Search
                <input
                  type="search"
                  value={fleetSearch}
                  onChange={(e) => setFleetSearch(e.target.value)}
                  placeholder={
                    missionRecordIdFilter
                      ? 'Narrow within this mission’s calls…'
                      : 'Source, job, operation, HTTP, JSON…'
                  }
                  className="min-h-[40px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40"
                  autoComplete="off"
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-xs font-medium text-foreground/70 lg:w-48">
                Source
                <select
                  value={fleetSourceFilter}
                  onChange={(e) => setFleetSourceFilter(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All sources</option>
                  {FLEET_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-full flex-col gap-1 text-xs font-medium text-foreground/70 lg:min-w-[11rem] lg:flex-1">
                Operation
                <select
                  value={fleetOperationFilter}
                  onChange={(e) => setFleetOperationFilter(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All operations</option>
                  {fleetOperationOptions.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-full flex-col gap-1 text-xs font-medium text-foreground/70 lg:w-36">
                HTTP
                <select
                  value={fleetHttpFilter}
                  onChange={(e) => setFleetHttpFilter(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All codes</option>
                  {fleetHttpOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-foreground/55">
              <span className="tabular-nums font-medium text-foreground/80">{filteredFleet.length}</span> of{' '}
              <span className="tabular-nums">{fleetEntries.length}</span> entries match filters — click column headers to
              sort; paginate below.
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <SortableTh
                        label="Time"
                        active={fleetSort.col === 'recorded_at'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('recorded_at')}
                      />
                      <SortableTh
                        label="Source"
                        active={fleetSort.col === 'source'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('source')}
                      />
                      <SortableTh
                        label="Job"
                        active={fleetSort.col === 'job_code'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('job_code')}
                      />
                      <SortableTh
                        label="Operation"
                        active={fleetSort.col === 'operation'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('operation')}
                      />
                      <SortableTh
                        label="HTTP"
                        active={fleetSort.col === 'http_status'}
                        dir={fleetSort.dir}
                        onClick={() => toggleFleetSort('http_status')}
                      />
                    </tr>
                  </thead>
                  <tbody>
                  {pagedFleet.map((e) => {
                    const userLabel = e.user_username != null ? String(e.user_username) : ''
                    return (
                      <tr
                        key={String(e.id)}
                        tabIndex={0}
                        className={`border-b border-border/60 align-top ${rowInteractive}`}
                        onClick={() => setDetailModal({ kind: 'fleet', row: e })}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault()
                            setDetailModal({ kind: 'fleet', row: e })
                          }
                        }}
                      >
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{String(e.recorded_at ?? '')}</td>
                        <td className="px-3 py-2">
                          <span className="text-xs text-foreground/85">{String(e.source ?? '')}</span>
                          {userLabel ? (
                            <span className="mt-0.5 block text-[11px] text-foreground/55">{userLabel}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{String(e.job_code ?? '') || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs font-medium">{String(e.operation ?? '')}</td>
                        <td className="px-3 py-2 text-[11px] tabular-nums text-foreground/70">{String(e.http_status ?? '')}</td>
                      </tr>
                    )
                  })}
                  </tbody>
                </table>
              </div>
              <TablePaginationBar
                idPrefix="fleet-log"
                page={fleetPageSafe}
                pageSize={fleetPageSize}
                total={sortedFleet.length}
                onPageChange={setFleetPage}
                onPageSizeChange={(n) => {
                  setFleetPageSize(n)
                  setFleetPage(1)
                }}
              />
              {fleetEntries.length === 0 ? (
                <p className="border-t border-border/80 p-6 text-center text-sm text-foreground/60">
                  No fleet API calls logged yet.
                </p>
              ) : filteredFleet.length === 0 ? (
                <p className="border-t border-border/80 p-6 text-center text-sm text-foreground/60">
                  No rows match the current search and filters.
                </p>
              ) : null}
            </div>
          </section>
        </>
      )}

      {detailModal && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/50" aria-hidden />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="log-detail-title"
                className="relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <p id="log-detail-title" className="text-base font-semibold text-foreground">
                      {detailModal.kind === 'mission' ? 'Mission status payload' : 'Fleet API payload'}
                    </p>
                    {detailModal.kind === 'mission' ? (
                      <p className="mt-1 font-mono text-xs text-foreground/70">{String(detailModal.row.job_code ?? '')}</p>
                    ) : (
                      <p className="mt-1 font-mono text-xs text-foreground/70">
                        {String(detailModal.row.operation ?? '')} · HTTP {String(detailModal.row.http_status ?? '')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-muted hover:text-foreground"
                    aria-label="Close"
                    onClick={() => setDetailModal(null)}
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {detailModal.kind === 'mission' ? (
                    <pre className="whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                      {prettyJson(detailModal.row.raw_json) || '—'}
                    </pre>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/55">Request</p>
                        <pre className="max-h-[min(40vh,320px)] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                          {prettyJson(detailModal.row.request_json) || '—'}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/55">Response</p>
                        <pre className="max-h-[min(40vh,320px)] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                          {prettyJson(detailModal.row.response_json) || '—'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 justify-end border-t border-border px-4 py-3">
                  <button
                    type="button"
                    className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                    onClick={() => setDetailModal(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

export default AmrLogs
