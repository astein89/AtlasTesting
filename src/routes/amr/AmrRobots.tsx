import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { amrFleetProxy } from '@/api/amr'
import { getAmrSettings } from '@/api/amr'
import { robotStatusChipClass, robotStatusFriendly } from '@/utils/amrRobotStatus'

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

function RobotGridCard({ row, onSelect }: { row: RobotRow; onSelect: () => void }) {
  const id = String(row.robotId ?? '')
  const model = String(row.robotType ?? '').trim()

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card to-muted/15 text-left shadow-sm ring-offset-background transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span
        className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b from-primary/70 via-primary/45 to-primary/15"
        aria-hidden
      />
      <div className="flex flex-1 flex-col p-4 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/45">Robot</p>
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
      </div>
      <div className="border-t border-border/40 bg-muted/25 px-4 py-2 text-center text-[11px] font-medium text-foreground/45 transition group-hover:bg-muted/40 group-hover:text-foreground/60">
        View details
      </div>
    </button>
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
      const data = await amrFleetProxy('robotQuery', { robotId: '', robotType: '' })
      if (!mountedRef.current) return
      const body = data as { data?: RobotRow[] }
      setRows(Array.isArray(body?.data) ? body.data : [])
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

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Robots</h1>
          <p className="mt-1 text-sm text-foreground/70">Live data from robotQuery (polls while this page is open).</p>
        </div>
        <button
          type="button"
          className="min-h-[44px] shrink-0 rounded-lg border border-border px-4 text-sm hover:bg-background"
          onClick={() => void loadRobots({ showSpinner: true })}
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <RobotGridCard
              key={String(r.robotId ?? Math.random())}
              row={r}
              onSelect={() => setDetail(r)}
            />
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
