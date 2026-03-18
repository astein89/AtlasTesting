import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { ExportPlanModal } from '../components/plan/ExportPlanModal'
import { formatDateTime } from '../lib/dateTimeConfig'
import type { TestPlan } from '../types'

type PlanSortKey = 'name' | 'description' | 'lastEdited' | 'recordCount'

export function TestPlansList() {
  const [plans, setPlans] = useState<TestPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [exportPlanId, setExportPlanId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<PlanSortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const navigate = useNavigate()

  const sortedPlans = useMemo(() => {
    const copy = [...plans]
    copy.sort((a, b) => {
      let aVal: string | number
      let bVal: string | number
      if (sortKey === 'name') {
        aVal = a.name ?? ''
        bVal = b.name ?? ''
      } else if (sortKey === 'description') {
        aVal = a.description ?? ''
        bVal = b.description ?? ''
      } else if (sortKey === 'lastEdited') {
        aVal = a.updatedAt ?? a.createdAt ?? ''
        bVal = b.updatedAt ?? b.createdAt ?? ''
      } else {
        aVal = a.recordCount ?? 0
        bVal = b.recordCount ?? 0
      }
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal), undefined, { sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [plans, sortKey, sortDir])

  const handleSort = (key: PlanSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const handleRowClick = (plan: TestPlan, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    navigate(`/test-plans/${plan.id}`)
  }

  useEffect(() => {
    api
      .get<TestPlan[]>('/test-plans')
      .then((r) => setPlans(r.data))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false))
  }, [])

  const handleNewPlan = () => {
    navigate('/test-plans/new', { state: { returnTo: '/test-plans' } })
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Test Plans</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={handleNewPlan}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              New Test Plan
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <>
          {/* Mobile: card layout */}
          <div className="w-full min-w-0 space-y-2 md:hidden">
            {plans.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
                No test plans yet.
              </p>
            ) : (
              sortedPlans.map((plan) => (
                <div
                  key={plan.id}
                  onClick={(e) => handleRowClick(plan, e)}
                  className="w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-background/50 active:bg-background/70"
                >
                  <p className="truncate font-medium text-foreground">{plan.name}</p>
                  <p className="mt-0.5 truncate text-sm text-foreground/70">
                    {plan.description?.trim() || '—'}
                  </p>
                  <p className="mt-0.5 text-sm text-foreground/60">
                    {(plan.updatedAt ?? plan.createdAt)
                      ? formatDateTime((plan.updatedAt ?? plan.createdAt)!)
                      : '—'}
                  </p>
                  <p className="mt-0.5 text-sm text-foreground/60">
                    {plan.recordCount ?? 0}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExportPlanId(plan.id)
                      }}
                      className="min-h-[44px] rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                    >
                      Export
                    </button>
                    {isAdmin && (
                      <Link
                        to={`/test-plans/${plan.id}/edit`}
                        state={{ returnTo: '/test-plans' }}
                        className="min-h-[44px] flex items-center rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                      >
                        Edit
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Desktop: table */}
          <div className="hidden w-full min-w-0 overflow-x-auto overflow-y-auto rounded-lg border border-border md:block">
            <table className="w-full">
              <thead className="sticky top-0 z-10 border-b border-border bg-card">
                <tr>
                  <th
                    className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                    onClick={() => handleSort('name')}
                  >
                    <span className="flex items-center gap-1">
                      Name
                      {sortKey === 'name' && (
                        <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                      )}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                    onClick={() => handleSort('description')}
                  >
                    <span className="flex items-center gap-1">
                      Description
                      {sortKey === 'description' && (
                        <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                      )}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer select-none px-4 py-3 text-right text-sm font-medium text-foreground hover:bg-background/50"
                    onClick={() => handleSort('lastEdited')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Last edited
                      {sortKey === 'lastEdited' && (
                        <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                      )}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer select-none px-4 py-3 text-right text-sm font-medium text-foreground hover:bg-background/50"
                    onClick={() => handleSort('recordCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Records
                      {sortKey === 'recordCount' && (
                        <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                      )}
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedPlans.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-foreground/60">
                      No test plans yet.
                    </td>
                  </tr>
                ) : (
                  sortedPlans.map((plan) => (
                    <tr
                      key={plan.id}
                      onClick={(e) => handleRowClick(plan, e)}
                      className="cursor-pointer bg-background transition-colors hover:bg-card"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{plan.name}</td>
                      <td className="px-4 py-3 text-sm text-foreground/70">
                        {plan.description?.trim() || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-foreground/70">
                        {(plan.updatedAt ?? plan.createdAt)
                          ? formatDateTime(plan.updatedAt ?? plan.createdAt!)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-foreground/70">
                        {plan.recordCount ?? 0}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex shrink-0 justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExportPlanId(plan.id)
                            }}
                            className="shrink-0 rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
                          >
                            Export
                          </button>
                          {isAdmin && (
                            <Link
                              to={`/test-plans/${plan.id}/edit`}
                              state={{ returnTo: '/test-plans' }}
                              className="shrink-0 rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
                            >
                              Edit
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {exportPlanId && (() => {
        const plan = plans.find((p) => p.id === exportPlanId)
        return plan ? (
          <ExportPlanModal
            planId={plan.id}
            planName={plan.name}
            onClose={() => setExportPlanId(null)}
            keyField={plan.keyField}
          />
        ) : null
      })()}
    </div>
  )
}
