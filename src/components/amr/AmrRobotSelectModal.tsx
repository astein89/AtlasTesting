import { useEffect, useMemo, useState } from 'react'
import { robotStatusChipClass, robotStatusFriendly } from '@/utils/amrRobotStatus'

export type AmrRobotPickRow = {
  id: string
  robotType: string
  status: unknown
  /** 0–100 from fleet `batteryLevel`, or null if unknown */
  batteryPct: number | null
}

type Props = {
  open: boolean
  onClose: () => void
  rows: AmrRobotPickRow[]
  selectedIds: string[]
  onConfirm: (ids: string[]) => void
  loading?: boolean
  error?: string | null
  /** Re-fetch robot list (e.g. same rate as Robots page / AMR settings). */
  onRefresh?: () => void
}

function PickRobotBatteryStrip({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <p className="text-[10px] text-foreground/40">—</p>
  }
  const barColor = pct > 25 ? 'bg-emerald-500 dark:bg-emerald-400' : pct > 10 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/90 shadow-inner">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 tabular-nums text-[10px] font-semibold text-foreground/85">{pct}%</span>
    </div>
  )
}

export function AmrRobotSelectModal({
  open,
  onClose,
  rows,
  selectedIds,
  onConfirm,
  loading,
  error,
  onRefresh,
}: Props) {
  const [local, setLocal] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!open) return
    setLocal(new Set(selectedIds))
  }, [open, selectedIds])

  const allIds = useMemo(() => rows.map((r) => r.id).filter(Boolean), [rows])

  if (!open) return null

  const toggle = (id: string) => {
    setLocal((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setLocal(new Set(allIds))
  const clearAll = () => setLocal(new Set())

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="amr-robot-select-title"
        className="relative z-10 flex max-h-[min(92vh,680px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id="amr-robot-select-title" className="text-base font-semibold text-foreground">
            Active robots
          </h2>
          <div className="flex items-center gap-1.5">
            {onRefresh ? (
              <button
                type="button"
                className="min-h-9 rounded-lg border border-border px-3 text-sm text-foreground/80 hover:bg-muted disabled:opacity-50"
                disabled={loading}
                onClick={onRefresh}
              >
                Refresh
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-muted hover:text-foreground"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <p className="text-sm text-foreground/60">Loading robots…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-foreground/60">No active robots reported by the fleet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
              {rows.map((r) => {
                const { label, code } = robotStatusFriendly(r.status)
                const chipCls = robotStatusChipClass(code)
                const checked = local.has(r.id)
                return (
                  <li key={r.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-pressed={checked}
                      className={`group relative flex w-full flex-col overflow-hidden rounded-xl border text-left shadow-sm ring-offset-background transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        checked
                          ? 'border-orange-500/75 bg-gradient-to-b from-orange-500/[0.14] via-orange-500/[0.08] to-muted/20 shadow-md ring-2 ring-orange-500/45 dark:border-orange-400/70 dark:ring-orange-400/40'
                          : 'border-border/80 bg-gradient-to-b from-card via-card to-muted/15 hover:-translate-y-px hover:border-primary/35 hover:shadow-md'
                      }`}
                    >
                      <span
                        className={`pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-r-full ${
                          checked
                            ? 'bg-gradient-to-b from-orange-500 via-orange-400/90 to-orange-500/40'
                            : 'bg-gradient-to-b from-primary/70 via-primary/45 to-primary/15'
                        }`}
                        aria-hidden
                      />

                      {checked && (
                        <div
                          className="pointer-events-none absolute left-1/2 top-1/2 z-0 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                          aria-hidden
                        >
                          <span className="absolute h-[4.5rem] w-[4.5rem] rounded-full bg-orange-400/25 dark:bg-orange-500/20" />
                          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-white shadow-md dark:bg-orange-500">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        </div>
                      )}

                      <div className="relative z-10 flex flex-1 flex-col p-3 pl-4 pr-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex min-w-0 items-baseline justify-between gap-3">
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground/45">Robot</p>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-foreground/45">Status</p>
                          </div>
                          <div className="flex min-w-0 items-start justify-between gap-2.5">
                            <div className="flex min-w-0 flex-1 items-baseline overflow-hidden">
                              <span className="shrink-0 font-mono text-lg font-semibold leading-tight tracking-tight text-foreground">
                                {r.id}
                              </span>
                              {r.robotType ? (
                                <span
                                  className="min-w-0 flex-1 truncate pl-2 text-xs font-normal leading-tight text-foreground"
                                  title={r.robotType}
                                >
                                  {r.robotType}
                                </span>
                              ) : null}
                            </div>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-medium leading-none ${chipCls}`}
                            >
                              <span>{label}</span>
                              {code != null ? (
                                <span className="font-mono text-xs font-normal tabular-nums opacity-70">{code}</span>
                              ) : null}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 border-t border-border/50 pt-2">
                          <PickRobotBatteryStrip pct={r.batteryPct} />
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              disabled={rows.length === 0}
              onClick={selectAll}
            >
              Select all
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              onClick={clearAll}
            >
              Clear
            </button>
          </div>
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              onConfirm([...local])
              onClose()
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
