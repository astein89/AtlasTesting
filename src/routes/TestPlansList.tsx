import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSortableHeader } from '../hooks/useSortableHeader'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { ExportPlanModal } from '../components/plan/ExportPlanModal'
import type { TestPlan } from '../types'

type SortKey = 'name' | 'description'
type SortLevel = { key: SortKey; dir: 'asc' | 'desc' }

export function TestPlansList() {
  const [plans, setPlans] = useState<TestPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [exportPlanId, setExportPlanId] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<SortLevel[]>([{ key: 'name', dir: 'asc' }])
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const navigate = useNavigate()

  const getVal = (plan: TestPlan, key: SortKey) =>
    key === 'name' ? (plan.name ?? '') : (plan.description ?? '')

  const sortedPlans = useMemo(() => {
    const copy = [...plans]
    copy.sort((a, b) => {
      for (const { key, dir } of sortOrder) {
        const cmp = getVal(a, key).localeCompare(getVal(b, key), undefined, { sensitivity: 'base' })
        const result = dir === 'asc' ? cmp : -cmp
        if (result !== 0) return result
      }
      return 0
    })
    return copy
  }, [plans, sortOrder])

  const handleSort = (key: SortKey, addSecondary: boolean) => {
    setSortOrder((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (addSecondary) {
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], dir: next[idx].dir === 'asc' ? 'desc' : 'asc' }
          return next
        }
        return [...prev, { key, dir: 'asc' }]
      }
      if (idx >= 0 && prev.length === 1) {
        return [{ key, dir: prev[0].dir === 'asc' ? 'desc' : 'asc' }]
      }
      return [{ key, dir: 'asc' }]
    })
  }

  const getSortHandlers = useSortableHeader(handleSort)
  const getSortIndex = (key: SortKey) => sortOrder.findIndex((s) => s.key === key)
  const getSortDir = (key: SortKey) => sortOrder.find((s) => s.key === key)?.dir

  const handleRowClick = (plan: TestPlan, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    navigate(`/test-plans/${plan.id}/data`)
  }

  useEffect(() => {
    api
      .get<TestPlan[]>('/test-plans')
      .then((r) => setPlans(r.data))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Test Plans</h1>
        {isAdmin && (
          <Link
            to="/test-plans/new"
            className="min-h-[44px] shrink-0 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 sm:min-h-0"
          >
            New Test Plan
          </Link>
        )}
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th
                  className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('name')}
                  title="Tap to sort. Long-press or Shift+click to add secondary sort."
                >
                  <span className="flex items-center gap-1">
                    Name
                    {getSortIndex('name') >= 0 && (
                      <span className="text-foreground/60">
                        {getSortIndex('name') + 1}{getSortDir('name') === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('description')}
                  title="Tap to sort. Long-press or Shift+click to add secondary sort."
                >
                  <span className="flex items-center gap-1">
                    Test plan
                    {getSortIndex('description') >= 0 && (
                      <span className="text-foreground/60">
                        {getSortIndex('description') + 1}{getSortDir('description') === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedPlans.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-foreground/60">
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
                  <td className="px-4 py-3 font-medium text-foreground">
                    {plan.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground/70">
                    {plan.description || '—'}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setExportPlanId(plan.id)
                        }}
                        className="min-h-[44px] min-w-[44px] rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background sm:min-h-0 sm:min-w-0 sm:py-1"
                      >
                        Export
                      </button>
                      {isAdmin && (
                        <Link
                          to={`/test-plans/${plan.id}/edit`}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background sm:min-h-0 sm:min-w-0 sm:py-1"
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
      )}
      {exportPlanId && (() => {
        const plan = plans.find((p) => p.id === exportPlanId)
        return plan ? (
          <ExportPlanModal
            planId={plan.id}
            planName={plan.name}
            onClose={() => setExportPlanId(null)}
          />
        ) : null
      })()}
    </div>
  )
}
