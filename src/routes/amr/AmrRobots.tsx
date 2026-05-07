import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  amrFleetProxy,
  getAmrSettings,
  listAmrRobotLocks,
  setAmrRobotLock,
  type AmrRobotLockRow,
} from '@/api/amr'
import { useAuthStore } from '@/store/authStore'
import { isRobotOffMapStatus, robotStatusChipClass, robotStatusFriendly } from '@/utils/amrRobotStatus'

type RobotRow = Record<string, unknown>

type FieldDef = { key: string; label: string }

/** Grouped fields — easier to scan than one long list. */
const ROBOT_DETAIL_SECTIONS: { title: string; keys: FieldDef[] }[] = [
  {
    title: 'Location & pose',
    keys: [
      { key: 'mapCode', label: 'Map' },
      { key: 'floorNumber', label: 'Floor' },
      { key: 'buildingCode', label: 'Building' },
      { key: 'nodeCode', label: 'Node code' },
      { key: 'nodeLabel', label: 'Node label' },
      { key: 'nodeNumber', label: 'Node #' },
      { key: 'nodeForeignCode', label: 'Foreign node code' },
      { key: 'x', label: 'X (m)' },
      { key: 'y', label: 'Y (m)' },
      { key: 'robotOrientation', label: 'Orientation (°)' },
    ],
  },
  {
    title: 'Status & payload',
    keys: [
      { key: 'status', label: 'Status code' },
      { key: 'occupyStatus', label: 'Occupy status' },
      { key: 'batteryLevel', label: 'Battery' },
      { key: 'liftStatus', label: 'Lift status' },
      { key: 'containerCode', label: 'Container' },
    ],
  },
  {
    title: 'Diagnostics',
    keys: [
      { key: 'reliability', label: 'Reliability' },
      { key: 'runTime', label: 'Runtime' },
      { key: 'mileage', label: 'Mileage' },
      { key: 'karOsVersion', label: 'KAR OS version' },
    ],
  },
]

/** Shown in the summary card above — omit from section lists to avoid duplication. */
const SUMMARY_ONLY_KEYS = new Set(['batteryLevel', 'status'])

const NUMERIC_KEYS = new Set(['x', 'y', 'nodeNumber', 'robotOrientation', 'occupyStatus', 'liftStatus', 'batteryLevel', 'reliability'])

/** Categories on the grid: attention first, then less available, then working states. Offline (2) is rendered after “Locked from missions”. */
const STATUS_GRID_SECTION_ORDER = [7, 6, 4, 5, 3] as const
/** Fleet “offline map” status code — grouped last on the Robots grid. */
const OFFLINE_STATUS_CODE = 2

function statusCategoryKey(status: unknown): number | 'none' {
  if (status === null || status === undefined || status === '') return 'none'
  const n = typeof status === 'number' ? status : Number(status)
  if (!Number.isFinite(n)) return 'none'
  return n
}

function robotSortName(row: RobotRow): string {
  return String(row.robotId ?? '').trim()
}

function compareRobotsByName(a: RobotRow, b: RobotRow): number {
  return robotSortName(a).localeCompare(robotSortName(b), undefined, { sensitivity: 'base', numeric: true })
}

function sortedStatusCategoryKeys(keys: Set<number | 'none'>): (number | 'none')[] {
  const orderNums = STATUS_GRID_SECTION_ORDER as readonly number[]
  const out: (number | 'none')[] = []
  for (const c of STATUS_GRID_SECTION_ORDER) {
    if (keys.has(c)) out.push(c)
  }
  const extras = [...keys].filter(
    (k): k is number =>
      k !== 'none' && typeof k === 'number' && !orderNums.includes(k) && k !== OFFLINE_STATUS_CODE
  )
  extras.sort((a, b) => a - b)
  out.push(...extras)
  if (keys.has('none')) out.push('none')
  return out
}

function categoryHeading(key: number | 'none'): string {
  if (key === 'none') return 'No status'
  return robotStatusFriendly(key).label
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\s+/, '')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatRobotFieldPlain(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  const s = String(value)
  if (key === 'batteryLevel' && s !== '' && !Number.isNaN(Number(s))) return `${s}%`
  return s
}

function BatterySummary({ level }: { level: unknown }) {
  const n = typeof level === 'number' ? level : Number(level)
  const pct = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null
  if (pct === null) return <span className="text-sm text-foreground/50">Battery unknown</span>
  const barColor = pct > 25 ? 'bg-emerald-500 dark:bg-emerald-400' : pct > 10 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="min-w-0 flex-1 sm:max-w-xs">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-foreground/60">
        <span>Battery</span>
        <span className="tabular-nums font-semibold text-foreground">{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function StatusChip({ value }: { value: unknown }) {
  const { label, code } = robotStatusFriendly(value)
  const chipCls = robotStatusChipClass(code)
  return (
    <span
      title={code != null ? `Status code ${code}` : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${chipCls}`}
    >
      <span>{label}</span>
      {code != null ? (
        <span className="font-mono text-[11px] font-normal tabular-nums opacity-70">{code}</span>
      ) : null}
    </span>
  )
}

function RobotCardBatteryStrip({ level }: { level: unknown }) {
  const n = typeof level === 'number' ? level : Number(level)
  const pct = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null
  if (pct === null) {
    return <p className="text-[11px] text-foreground/40">No battery data</p>
  }
  const barColor = pct > 25 ? 'bg-emerald-500 dark:bg-emerald-400' : pct > 10 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/90 shadow-inner">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 tabular-nums text-xs font-semibold text-foreground/85">{pct}%</span>
    </div>
  )
}

function RobotCardChevron() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-foreground/25 transition group-hover:translate-x-0.5 group-hover:text-primary/70"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

/** Inline "Locked" chip — tagged on cards plus the picker so the lock state is visible alongside live fleet status. */
function LockedChip() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-500/45 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300"
      title="Locked from new fleet missions"
    >
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 11v2m-5 4h10a2 2 0 002-2v-5a2 2 0 00-2-2H7a2 2 0 00-2 2v5a2 2 0 002 2zm8-8V7a3 3 0 10-6 0v2"
        />
      </svg>
      Locked
    </span>
  )
}

function RobotGridCard({
  row,
  locked,
  canLock,
  lockBusy,
  onSelect,
  onToggleLock,
}: {
  row: RobotRow
  locked: boolean
  canLock: boolean
  lockBusy: boolean
  onSelect: () => void
  onToggleLock: () => void
}) {
  const id = String(row.robotId ?? '')
  const model = String(row.robotType ?? '').trim()

  return (
    <div
      className={`group relative flex w-full flex-col overflow-hidden rounded-2xl border bg-gradient-to-b from-card via-card to-muted/15 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        locked ? 'border-orange-500/55 hover:border-orange-500/70' : 'border-border/80 hover:border-primary/35'
      }`}
    >
      <span
        className={`pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full ${
          locked
            ? 'bg-gradient-to-b from-orange-500/85 via-orange-400/55 to-orange-500/20'
            : 'bg-gradient-to-b from-primary/70 via-primary/45 to-primary/15'
        }`}
        aria-hidden
      />
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 flex-col p-4 pl-5 text-left ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/45">Robot</p>
              {locked ? <LockedChip /> : null}
            </div>
            <p className="mt-0.5 truncate font-mono text-base font-semibold tracking-tight text-foreground">{id}</p>
            {model ? (
              <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-foreground/65" title={model}>
                {model}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            <RobotCardChevron />
          </div>
        </div>

        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">Status</p>
            <StatusChip value={row.status} />
          </div>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">Battery</p>
            <RobotCardBatteryStrip level={row.batteryLevel} />
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-muted/25 px-3 py-2 text-[11px] font-medium text-foreground/45 transition group-hover:bg-muted/40">
        <button
          type="button"
          onClick={onSelect}
          className="text-[11px] font-medium text-foreground/45 hover:text-foreground/70"
        >
          View details
        </button>
        {canLock ? (
          <button
            type="button"
            onClick={onToggleLock}
            disabled={lockBusy}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition disabled:opacity-50 ${
              locked
                ? 'border-orange-500/50 bg-orange-500/10 text-orange-700 hover:bg-orange-500/15 dark:text-orange-300'
                : 'border-border bg-background text-foreground/75 hover:bg-muted'
            }`}
            title={
              locked
                ? 'Allow this robot to receive new fleet missions'
                : 'Block this robot from receiving new fleet missions'
            }
          >
            {lockBusy ? '…' : locked ? 'Unlock' : 'Lock'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function FieldRows({ rows }: { rows: { key: string; label: string; node: ReactNode }[] }) {
  return (
    <div className="divide-y divide-border/80">
      {rows.map(({ key, label, node }) => (
        <div
          key={key}
          className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
        >
          <dt className="shrink-0 text-[13px] text-foreground/55">{label}</dt>
          <dd className="min-w-0 text-right text-sm text-foreground sm:text-right">{node}</dd>
        </div>
      ))}
    </div>
  )
}

function renderRobotCell(key: string, raw: unknown): ReactNode {
  if (key === 'batteryLevel') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) return <span className="text-foreground/50">{formatRobotFieldPlain(key, raw)}</span>
    return (
      <span className="inline-flex items-center gap-2 tabular-nums">
        <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted align-middle">
          <span
            className={`block h-full rounded-full ${n > 25 ? 'bg-emerald-500' : n > 10 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(100, Math.max(0, n))}%` }}
          />
        </span>
        {Math.round(n)}%
      </span>
    )
  }
  const plain = formatRobotFieldPlain(key, raw)
  if (plain === '—') return <span className="text-foreground/45">—</span>
  const monoKeys = new Set(['nodeCode', 'containerCode', 'nodeForeignCode', 'karOsVersion', 'mapCode'])
  const className = [
    'break-all',
    monoKeys.has(key) ? 'font-mono text-[13px]' : '',
    NUMERIC_KEYS.has(key) ? 'tabular-nums' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return <span className={className}>{plain}</span>
}

function RobotDetailBody({ detail }: { detail: RobotRow }) {
  const { sections, extraRows } = useMemo(() => {
    const seen = new Set<string>()
    seen.add('robotId')
    seen.add('robotType')

    const sectionsOut = ROBOT_DETAIL_SECTIONS.map(({ title, keys }) => {
      const rows = keys
        .filter(({ key }) => key in detail)
        .map(({ key, label }) => {
          seen.add(key)
          if (SUMMARY_ONLY_KEYS.has(key)) {
            return null
          }
          return {
            key,
            label,
            node: renderRobotCell(key, detail[key]),
          }
        })
        .filter((r): r is { key: string; label: string; node: ReactNode } => r !== null)
      return { title, rows }
    }).filter((s) => s.rows.length > 0)

    const extraKeys = Object.keys(detail)
      .filter((k) => !seen.has(k))
      .sort((a, b) => a.localeCompare(b))
    const extra = extraKeys.map((key) => ({
      key,
      label: humanizeKey(key),
      node: renderRobotCell(key, detail[key]),
    }))
    return { sections: sectionsOut, extraRows: extra }
  }, [detail])

  const titleId = String(detail.robotId ?? detail.robot_id ?? 'robot')

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-muted/20 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45">Fleet robot</p>
        <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-foreground">{titleId}</p>
        {detail.robotType != null && detail.robotType !== '' ? (
          <p className="mt-1 text-sm leading-snug text-foreground/75">{String(detail.robotType)}</p>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <BatterySummary level={detail.batteryLevel} />
          <StatusChip value={detail.status} />
        </div>
      </div>

      <div className="grid gap-4">
        {sections.map(({ title, rows }) => (
          <section key={title} className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <h3 className="mb-1 border-b border-border/70 pb-2 text-xs font-semibold uppercase tracking-wide text-foreground/55">
              {title}
            </h3>
            <FieldRows rows={rows} />
          </section>
        ))}
      </div>

      {extraRows.length > 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-3">
          <h3 className="mb-1 border-b border-border/70 pb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
            Other fields
          </h3>
          <FieldRows rows={extraRows} />
        </section>
      ) : null}

      <details className="group rounded-lg border border-border/80 bg-muted/20">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-foreground/70 hover:bg-muted/40">
          Raw JSON
          <span className="ml-2 text-xs font-normal text-foreground/45">(debug)</span>
        </summary>
        <pre className="max-h-[min(200px,22vh)] overflow-auto border-t border-border/60 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
          {JSON.stringify(detail, null, 2)}
        </pre>
      </details>
    </div>
  )
}

export function AmrRobots() {
  const [rows, setRows] = useState<RobotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<RobotRow | null>(null)
  const [pollMs, setPollMs] = useState(5000)
  const [lockRows, setLockRows] = useState<AmrRobotLockRow[]>([])
  const [lockBusyId, setLockBusyId] = useState<string | null>(null)
  const [lockErr, setLockErr] = useState('')
  const canLock = useAuthStore((s) => s.hasPermission('amr.robots.lock'))
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void getAmrSettings().then((s) => setPollMs(Math.max(3000, s.pollMsRobots)))
  }, [])

  const loadRobots = useCallback(async (opts?: { showSpinner?: boolean }) => {
    const showSpinner = opts?.showSpinner === true
    if (showSpinner) setLoading(true)
    try {
      const [data, locks] = await Promise.all([
        amrFleetProxy('robotQuery', { robotId: '', robotType: '' }),
        listAmrRobotLocks().catch(() => [] as AmrRobotLockRow[]),
      ])
      if (!mountedRef.current) return
      const body = data as { data?: RobotRow[] }
      setRows(Array.isArray(body?.data) ? body.data : [])
      setLockRows(locks)
      setErr('')
    } catch {
      if (mountedRef.current) setErr('Failed to load robots')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRobots()
    const t = setInterval(() => void loadRobots(), pollMs)
    return () => clearInterval(t)
  }, [pollMs, loadRobots])

  const lockedSet = useMemo(() => {
    const s = new Set<string>()
    for (const r of lockRows) {
      if (r.locked) s.add(r.robotId)
    }
    return s
  }, [lockRows])

  /**
   * Off-map robots (status 1) stay hidden. Exception: locked + departure is surfaced only when the user
   * has `amr.robots.lock` so they can unlock; without that permission keep the legacy hide-them rule.
   * Same for synthetic rows for locks absent from fleet — only operators who can unlock need those rows.
   */
  const visibleRows = useMemo(() => {
    const liveIds = new Set<string>()
    const out: RobotRow[] = []
    for (const r of rows) {
      const id = String(r.robotId ?? '').trim()
      liveIds.add(id)
      const allowLockedOffMapException = canLock && lockedSet.has(id)
      if (!isRobotOffMapStatus(r.status) || allowLockedOffMapException) out.push(r)
    }
    if (canLock) {
      /** Locked robots the live fleet didn't report — synthetic row only so someone with lock perm can unlock. */
      for (const id of lockedSet) {
        if (!liveIds.has(id)) out.push({ robotId: id, status: '', batteryLevel: null, robotType: '' })
      }
    }
    return out
  }, [rows, lockedSet, canLock])

  const toggleLock = useCallback(
    async (robotId: string, nextLocked: boolean) => {
      const id = robotId.trim()
      if (!id) return
      setLockBusyId(id)
      setLockErr('')
      const prev = lockRows
      setLockRows((cur) => {
        const idx = cur.findIndex((r) => r.robotId === id)
        if (idx >= 0) {
          const copy = cur.slice()
          copy[idx] = { ...copy[idx], locked: nextLocked }
          return copy
        }
        return [
          ...cur,
          { robotId: id, locked: nextLocked, lockedAt: null, lockedBy: null, notes: null },
        ]
      })
      try {
        const updated = await setAmrRobotLock(id, { locked: nextLocked })
        if (!mountedRef.current) return
        setLockRows((cur) => {
          const idx = cur.findIndex((r) => r.robotId === id)
          if (idx >= 0) {
            const copy = cur.slice()
            copy[idx] = updated
            return copy
          }
          return [...cur, updated]
        })
      } catch {
        if (!mountedRef.current) return
        setLockRows(prev)
        setLockErr(`Failed to ${nextLocked ? 'lock' : 'unlock'} ${id}.`)
      } finally {
        if (mountedRef.current) setLockBusyId(null)
      }
    },
    [lockRows]
  )

  /**
   * Unlocked robots are grouped by fleet status first; “Locked from missions” follows; offline (status 2) is last.
   */
  const statusSections = useMemo(() => {
    const lockedSection: RobotRow[] = []
    const byKey = new Map<number | 'none', RobotRow[]>()
    for (const r of visibleRows) {
      const id = String(r.robotId ?? '').trim()
      if (lockedSet.has(id)) {
        lockedSection.push(r)
        continue
      }
      const key = statusCategoryKey(r.status)
      const list = byKey.get(key)
      if (list) list.push(r)
      else byKey.set(key, [r])
    }
    for (const list of byKey.values()) list.sort(compareRobotsByName)
    lockedSection.sort(compareRobotsByName)
    const unlockedKeysNoOffline = new Set(
      [...byKey.keys()].filter((k) => k !== OFFLINE_STATUS_CODE)
    )
    const keys = sortedStatusCategoryKeys(unlockedKeysNoOffline)
    const out: { key: number | 'none' | 'locked'; heading: string; rows: RobotRow[] }[] = []
    for (const k of keys) out.push({ key: k, heading: categoryHeading(k), rows: byKey.get(k)! })
    if (lockedSection.length > 0) {
      out.push({ key: 'locked', heading: 'Locked from missions', rows: lockedSection })
    }
    const offlineRows = byKey.get(OFFLINE_STATUS_CODE)
    if (offlineRows && offlineRows.length > 0) {
      out.push({
        key: OFFLINE_STATUS_CODE,
        heading: categoryHeading(OFFLINE_STATUS_CODE),
        rows: offlineRows,
      })
    }
    return out
  }, [visibleRows, lockedSet])

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Robots</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Live data from robotQuery (polls while this page is open). Robots with status 1 are not on the map and are
            omitted unless they are locked and you have permission to lock or unlock robots.{' '}
            {canLock ? 'Use Lock to block a robot from receiving new missions.' : ''}
          </p>
        </div>
        <button
          type="button"
          className="min-h-[44px] shrink-0 rounded-lg border border-border px-4 text-sm hover:bg-background"
          onClick={() => void loadRobots({ showSpinner: true })}
        >
          Refresh
        </button>
      </div>
      {lockErr ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/[0.09] px-3 py-2 text-sm text-red-950 dark:text-red-50"
        >
          {lockErr}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : visibleRows.length === 0 && rows.length > 0 ? (
        <p className="text-sm text-foreground/60">
          Every robot in the fleet response is off-map (status 1). Nothing to show.
        </p>
      ) : (
        <div className="space-y-8">
          {statusSections.map(({ key, heading, rows: sectionRows }) => (
            <section key={String(key)} className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/70 pb-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/80">{heading}</h2>
                <span className="text-xs font-medium tabular-nums text-foreground/50">
                  {sectionRows.length} robot{sectionRows.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sectionRows.map((r, i) => {
                  const id = String(r.robotId ?? '').trim()
                  const locked = lockedSet.has(id)
                  return (
                    <RobotGridCard
                      key={robotSortName(r) !== '' ? robotSortName(r) : `row-${String(key)}-${i}`}
                      row={r}
                      locked={locked}
                      canLock={canLock}
                      lockBusy={lockBusyId === id}
                      onSelect={() => setDetail(r)}
                      onToggleLock={() => void toggleLock(id, !locked)}
                    />
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">Robot detail</h2>
              <button
                type="button"
                className="shrink-0 rounded-lg px-2 py-1 text-sm hover:bg-background"
                onClick={() => setDetail(null)}
              >
                Close
              </button>
            </div>
            <RobotDetailBody detail={detail} />
          </div>
        </div>
      )}
    </div>
  )
}

export default AmrRobots
