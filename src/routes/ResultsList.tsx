import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUserPreference } from '../hooks/useUserPreference'
import { api } from '../api/client'
import { formatDateTime } from '../lib/dateTimeConfig'
import { PopupSelect } from '../components/ui/PopupSelect'
import { ColumnFilterDropdown } from '../components/data/ColumnFilterDropdown'

interface Record {
  id: string
  testPlanId: string
  planName: string
  recordedAt: string
  enteredBy: string
  status: string
}

export function ResultsList() {
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [testPlanId, setTestPlanId] = useUserPreference('atlas-results-filter', '')
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null)
  const filterAnchorRefs = useRef<Record<string, HTMLTableCellElement | null>>({})

  useEffect(() => {
    api.get('/test-plans').then((r) => setPlans(r.data))
  }, [])

  useEffect(() => {
    const params: Record<string, string> = { limit: '100' }
    if (testPlanId) params.testPlanId = testPlanId
    api
      .get<Record[]>('/records', { params })
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [testPlanId])

  const filteredRecords = useMemo(() => {
    let result = records
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter((r) => {
        const plan = r.planName?.toLowerCase() ?? ''
        const date = formatDateTime(r.recordedAt).toLowerCase()
        return plan.includes(q) || date.includes(q)
      })
    }
    for (const [colKey, allowed] of Object.entries(columnFilters)) {
      if (allowed.size === 0) continue
      result = result.filter((r) => {
        const v = colKey === 'plan' ? r.planName : formatDateTime(r.recordedAt)
        return allowed.has(v)
      })
    }
    return result
  }, [records, searchQuery, columnFilters])

  const hasActiveFilters = searchQuery.trim() !== '' || Object.values(columnFilters).some((s) => s.size > 0)

  const clearAllFilters = () => {
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
  }

  const getColumnValues = (key: string): string[] => {
    if (key === 'plan') return [...new Set(records.map((r) => r.planName))]
    if (key === 'runAt') return records.map((r) => formatDateTime(r.recordedAt))
    return []
  }

  return (
    <div className="w-full min-w-0">
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Results</h1>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <PopupSelect
          label="Filter by plan"
          value={testPlanId}
          onChange={setTestPlanId}
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
          emptyOption="All"
        />
        <div className="flex flex-1 min-w-[160px] max-w-xs flex-col">
          <label className="mb-1 block text-sm font-medium text-foreground">Search</label>
          <div className="relative">
            <input
              type="search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 pl-9 text-sm text-foreground placeholder:text-foreground/50"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
          </div>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
          >
            Clear filters
          </button>
        )}
        {hasActiveFilters && (
          <span className="text-sm text-foreground/60">
            {filteredRecords.length} of {records.length} rows
          </span>
        )}
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <>
          {/* Mobile: card layout */}
          <div className="w-full min-w-0 space-y-2 md:hidden">
            {filteredRecords.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
                {records.length === 0 ? 'No results.' : 'No rows match the current filters.'}
              </p>
            ) : (
              filteredRecords.map((r) => (
                <Link
                  key={r.id}
                  to={`/results/${r.id}`}
                  className="block w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-background/50"
                >
                  <p className="truncate font-medium text-foreground">{r.planName}</p>
                  <p className="mt-0.5 truncate text-sm text-foreground/70">
                    {formatDateTime(r.recordedAt)}
                  </p>
                  <span className="mt-2 inline-block text-sm text-primary">View →</span>
                </Link>
              ))
            )}
          </div>
          {/* Desktop: table */}
          <div className="hidden w-full min-w-0 overflow-x-auto rounded-lg border border-border md:block">
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th
                  ref={(el) => { filterAnchorRefs.current['plan'] = el }}
                  className="relative min-w-0 px-4 py-2 text-left text-sm font-medium text-foreground"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 truncate">Plan</span>
                    <button
                      type="button"
                      onClick={() => setOpenFilterColumn((c) => (c === 'plan' ? null : 'plan'))}
                      className={`shrink-0 rounded p-0.5 hover:bg-background ${columnFilters['plan']?.size ? 'text-primary' : 'text-foreground/50'}`}
                      title="Filter column"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                    </button>
                  </span>
                  {openFilterColumn === 'plan' && (
                    <ColumnFilterDropdown
                      columnKey="plan"
                      columnLabel="Plan"
                      values={getColumnValues('plan')}
                      selected={columnFilters['plan'] ?? new Set()}
                      onChange={(s) => setColumnFilters((p) => ({ ...p, plan: s }))}
                      onClose={() => setOpenFilterColumn(null)}
                      anchorRef={{ current: filterAnchorRefs.current['plan'] }}
                    />
                  )}
                </th>
                <th
                  ref={(el) => { filterAnchorRefs.current['runAt'] = el }}
                  className="relative min-w-0 px-4 py-2 text-left text-sm font-medium text-foreground"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 truncate">Run At</span>
                    <button
                      type="button"
                      onClick={() => setOpenFilterColumn((c) => (c === 'runAt' ? null : 'runAt'))}
                      className={`shrink-0 rounded p-0.5 hover:bg-background ${columnFilters['runAt']?.size ? 'text-primary' : 'text-foreground/50'}`}
                      title="Filter column"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                    </button>
                  </span>
                  {openFilterColumn === 'runAt' && (
                    <ColumnFilterDropdown
                      columnKey="runAt"
                      columnLabel="Run At"
                      values={getColumnValues('runAt')}
                      selected={columnFilters['runAt'] ?? new Set()}
                      onChange={(s) => setColumnFilters((p) => ({ ...p, runAt: s }))}
                      onClose={() => setOpenFilterColumn(null)}
                      anchorRef={{ current: filterAnchorRefs.current['runAt'] }}
                    />
                  )}
                </th>
                <th className="px-4 py-2 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-foreground/60">
                    {records.length === 0 ? 'No results.' : 'No rows match the current filters.'}
                  </td>
                </tr>
              ) : (
              filteredRecords.map((r) => (
                <tr key={r.id} className="bg-background">
                  <td className="px-4 py-2 text-foreground">{r.planName}</td>
                  <td className="px-4 py-2 text-foreground">
                    {formatDateTime(r.recordedAt)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      to={`/results/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}
