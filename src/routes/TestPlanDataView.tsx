import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSortableHeader } from '../hooks/useSortableHeader'
import { useUserPreference } from '../hooks/useUserPreference'
import { format } from 'date-fns'
import { api } from '../api/client'
import { formatDecimalAsFraction } from '../utils/fraction'
import { useAuthStore } from '../store/authStore'
import { EditRecordModal } from '../components/data/EditRecordModal'
import { AddRecordModal } from '../components/data/AddRecordModal'
import { ColumnFilterDropdown } from '../components/data/ColumnFilterDropdown'
import { ExportPlanModal } from '../components/plan/ExportPlanModal'
import { SelectInput } from '../components/fields/SelectInput'
import {
  buildFormRowsFromOrder,
  isSeparatorId,
  isSeparatorLineId,
  normalizeFormLayoutOrder,
  parseFieldEntry,
  truncateFormRowsForCompact,
} from '../utils/formLayout'
import type { DataField, TestPlan } from '../types'
import { getStatusOptions } from '../types'

interface Record {
  id: string
  testPlanId: string
  planName: string
  recordedAt: string
  enteredBy: string
  status: string
  data: Record<string, string | number | boolean | string[]>
}

function getDefaultData(fields: DataField[]): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {}
  for (const f of fields) {
    if (f.type === 'number' || f.type === 'fraction') out[f.key] = 0
    else if (f.type === 'boolean') out[f.key] = false
    else if (f.type === 'longtext') out[f.key] = ''
    else if (f.type === 'select') out[f.key] = ''
    else if (f.type === 'status') {
      const opts = getStatusOptions(f)
      out[f.key] = opts[0] ?? 'In Progress'
    }
    else if (f.type === 'atlas_location') out[f.key] = ''
    else if (f.type === 'image') out[f.key] = f.config?.imageMultiple ? [] : ''
    else out[f.key] = ''
  }
  return out
}

export function TestPlanDataView() {
  const { planId } = useParams<{ planId: string }>()
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editData, setEditData] = useState<Record<string, string | number | boolean | string[]>>({})
  const [addData, setAddData] = useState<Record<string, string | number | boolean | string[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [compactCards, setCompactCards] = useUserPreference('atlas-compact-data-cards', false)
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null)
  const [showMobileFilterPanel, setShowMobileFilterPanel] = useState(false)
  const [selectedStatusTab, setSelectedStatusTab] = useState<string>('All')
  const [openColumnPicker, setOpenColumnPicker] = useState(false)
  const columnPickerAnchorRef = useRef<HTMLButtonElement | null>(null)
  const filterAnchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const isAdmin = useAuthStore((s) => s.isAdmin())

  const columnsPrefKey = planId ? `atlas-data-hidden-columns-${planId}` : 'atlas-data-hidden-columns-default'
  const [hiddenColumnKeys, setHiddenColumnKeys] = useUserPreference<string[]>(columnsPrefKey, [])
  const visibleFields = useMemo(
    () => fields.filter((f) => !hiddenColumnKeys.includes(f.key)),
    [fields, hiddenColumnKeys]
  )
  const toggleColumnVisibility = (fieldKey: string) => {
    setHiddenColumnKeys((prev) =>
      prev.includes(fieldKey) ? prev.filter((k) => k !== fieldKey) : [...prev, fieldKey]
    )
  }

  const loadRecords = () => {
    if (!planId) return
    api
      .get<Record[]>('/records', { params: { testPlanId: planId, limit: 100 } })
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]))
  }

  useEffect(() => {
    if (!planId) return
    api
      .get<TestPlan>(`/test-plans/${planId}`)
      .then((r) => {
        setPlan(r.data)
        const fieldIds = r.data.fieldIds?.length ? r.data.fieldIds : []
        if (fieldIds.length === 0) {
          setFields([])
          setAddData({})
          return
        }
        return Promise.all(
          fieldIds.map((fid: string) =>
            api.get<DataField>(`/fields/${fid}`).then((fr) => fr.data)
          )
        ).then((f) => {
          setFields(f)
          setAddData(getDefaultData(f))
        })
      })
      .catch(() => setPlan(null))
      .finally(() => setLoading(false))
  }, [planId])

  useEffect(() => {
    if (planId) loadRecords()
  }, [planId])

  const startAdd = () => {
    setIsAdding(true)
    setAddData(getDefaultData(fields))
  }

  const cancelAdd = () => setIsAdding(false)

  const saveAdd = async () => {
    if (!planId) return
    setSubmitting(true)
    try {
      await api.post('/records', { testPlanId: planId, data: addData, status: 'partial' })
      loadRecords()
      setIsAdding(false)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to add data')
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (record: Record) => {
    setEditingId(record.id)
    setEditData({ ...record.data })
  }

  const cancelEdit = () => setEditingId(null)

  const deleteRecord = async (recordId: string) => {
    if (!confirm('Delete this row?')) return
    setSubmitting(true)
    try {
      await api.delete(`/records/${recordId}`)
      loadRecords()
      if (editingId === recordId) setEditingId(null)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to delete')
    } finally {
      setSubmitting(false)
    }
  }

  const saveEdit = async () => {
    if (!editingId) return
    const rec = records.find((r) => r.id === editingId)
    if (!rec) return
    setSubmitting(true)
    try {
      await api.put(`/records/${editingId}`, { data: editData, status: rec.status })
      loadRecords()
      setEditingId(null)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  const updateAddField = (key: string, value: string | number | boolean) => {
    setAddData((d) => ({ ...d, [key]: value }))
  }

  const updateEditField = (key: string, value: string | number | boolean) => {
    setEditData((d) => ({ ...d, [key]: value }))
  }

  const updateRecordField = async (record: Record, key: string, value: string | number | boolean) => {
    const newData = { ...record.data, [key]: value }
    try {
      await api.put(`/records/${record.id}`, { data: newData, status: record.status })
      setRecords((prev) =>
        prev.map((r) => (r.id === record.id ? { ...r, data: newData } : r))
      )
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to update')
    }
  }

  const fieldLayout = plan?.fieldLayout ?? {}
  const editingRecord = records.find((r) => r.id === editingId)

  type SortKey = 'date' | string
  type SortLevel = { key: SortKey; dir: 'asc' | 'desc' }
  const sortStorageKey = planId ? `atlas-data-sort-${planId}` : 'atlas-data-sort-default'
  const defaultSortOrder = useMemo<SortLevel[]>(
    () =>
      plan?.defaultSortOrder?.length
        ? plan.defaultSortOrder
        : [{ key: 'date', dir: 'desc' }],
    [plan?.defaultSortOrder]
  )
  const [sortOrder, setSortOrder] = useUserPreference<SortLevel[]>(
    sortStorageKey,
    defaultSortOrder,
    JSON.stringify,
    (s) => {
      try {
        const parsed = JSON.parse(s) as SortLevel[]
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      } catch {
        // ignore
      }
      return defaultSortOrder
    }
  )

  const getVal = (record: Record, key: SortKey): string | number | boolean => {
    if (key === 'date') return record.recordedAt
    return record.data[key] ?? ''
  }

  const compare = (aVal: string | number | boolean, bVal: string | number | boolean, dir: 'asc' | 'desc'): number => {
    const aStr = String(aVal)
    const bStr = String(bVal)
    const numA = Number(aVal)
    const numB = Number(bVal)
    let cmp: number
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      cmp = numA - numB
    } else {
      cmp = aStr.localeCompare(bStr, undefined, { sensitivity: 'base' })
    }
    return dir === 'asc' ? cmp : -cmp
  }

  const sortedRecords = useMemo(() => {
    const copy = [...records]
    copy.sort((a, b) => {
      for (const { key, dir } of sortOrder) {
        const cmp = compare(getVal(a, key), getVal(b, key), dir)
        if (cmp !== 0) return cmp
      }
      return 0
    })
    return copy
  }, [records, sortOrder])

  const getDisplayVal = (record: Record, key: SortKey, field?: DataField): string => {
    const v = getVal(record, key)
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'number') return String(v)
    if (field?.type === 'image') {
      const arr = Array.isArray(v) ? v : v ? [v] : []
      return arr.length ? `${arr.length} photo(s)` : '—'
    }
    return String(v ?? '')
  }

  const statusField = fields.find((f) => f.type === 'status')
  const statusTabs = useMemo(() => {
    if (!statusField) return []
    const values = new Set<string>()
    let hasNoStatus = false
    for (const r of sortedRecords) {
      const v = String(r.data[statusField.key] ?? '').trim()
      if (v) values.add(v)
      else hasNoStatus = true
    }
    const rest = [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    return hasNoStatus ? ['All', '(No Status)', ...rest] : ['All', ...rest]
  }, [statusField, sortedRecords])

  useEffect(() => {
    if (statusTabs.length > 0 && !statusTabs.includes(selectedStatusTab)) setSelectedStatusTab('All')
  }, [statusTabs, selectedStatusTab])

  const filteredRecords = useMemo(() => {
    let result = sortedRecords
    if (statusField && selectedStatusTab && selectedStatusTab !== 'All') {
      result = result.filter((r) => {
        const v = String(r.data[statusField.key] ?? '').trim()
        return selectedStatusTab === '(No Status)' ? !v : v === selectedStatusTab
      })
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter((r) => {
        const dateStr = format(new Date(r.recordedAt), 'MM/dd/yyyy HH:mm')
        if (dateStr.toLowerCase().includes(q)) return true
        for (const f of fields) {
          const v = getDisplayVal(r, f.key)
          if (v.toLowerCase().includes(q)) return true
        }
        return false
      })
    }
    for (const [colKey, allowed] of Object.entries(columnFilters)) {
      if (allowed.size === 0) continue
      const f = fields.find((x) => x.key === colKey)
      result = result.filter((r) => {
        const v = colKey === 'date' ? format(new Date(r.recordedAt), 'MM/dd/yyyy HH:mm') : getDisplayVal(r, colKey, f)
        return allowed.has(v)
      })
    }
    return result
  }, [sortedRecords, statusField, selectedStatusTab, searchQuery, columnFilters, fields])

  const hasActiveFilters = searchQuery.trim() !== '' || Object.values(columnFilters).some((s) => s.size > 0)

  const sortDiffersFromDefault =
    sortOrder.length !== defaultSortOrder.length ||
    sortOrder.some((s, i) => defaultSortOrder[i]?.key !== s.key || defaultSortOrder[i]?.dir !== s.dir)
  const statusDiffersFromDefault = statusTabs.length > 0 && selectedStatusTab !== 'All'
  const differsFromDefault = sortDiffersFromDefault || hasActiveFilters || statusDiffersFromDefault

  const clearToDefault = () => {
    setSortOrder(defaultSortOrder)
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
    setSelectedStatusTab('All')
  }

  const getColumnValues = (key: SortKey): string[] => {
    const f = fields.find((x) => x.key === key)
    return sortedRecords.map((r) =>
      key === 'date' ? format(new Date(r.recordedAt), 'MM/dd/yyyy HH:mm') : getDisplayVal(r, key, f)
    )
  }

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
      return [{ key, dir: 'desc' }]
    })
  }

  const getSortHandlers = useSortableHeader(handleSort)
  const getSortIndex = (key: SortKey) => sortOrder.findIndex((s) => s.key === key)
  const getSortDir = (key: SortKey) => sortOrder.find((s) => s.key === key)?.dir

  const handleRowClick = (record: Record, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    startEdit(record)
  }

  if (loading || !plan) return <p className="text-foreground/60">Loading...</p>

  const hasFields = fields.length > 0

  return (
    <div className="w-full min-w-0">
      <Link
        to="/test-plans"
        className="mb-2 flex min-h-[44px] w-fit items-center text-sm text-foreground/60 hover:text-foreground sm:min-h-0"
      >
        ← Back to plans
      </Link>
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Data: {plan.name}</h1>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
          >
            Export
          </button>
          {isAdmin && (
            <Link
              to={`/test-plans/${plan.id}/edit`}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
            >
              Edit plan
            </Link>
          )}
          {hasFields && (
            <button
              type="button"
              onClick={startAdd}
              className="min-h-[44px] shrink-0 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 sm:min-h-0"
            >
              + Add row
            </button>
          )}
        </div>
      </div>
      {(plan.constraints || plan.description) && (
        <div className="mb-6 w-full min-w-0 rounded-lg border border-border bg-card/50 p-5">
          <div className="grid gap-6 sm:grid-cols-2">
            {plan.description && (
              <div className="min-w-0">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                  Test plan
                </h3>
                <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
                  {plan.description}
                </p>
              </div>
            )}
            {plan.constraints && (
              <div className="min-w-0">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                  Constraints
                </h3>
                <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
                  {plan.constraints}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {isAdding && (
        <AddRecordModal
          fields={fields}
          data={addData}
          onDataChange={updateAddField}
          onSave={saveAdd}
          onCancel={cancelAdd}
          submitting={submitting}
          formLayoutOrder={plan?.formLayoutOrder}
        />
      )}
      {showExportModal && (
        <ExportPlanModal
          planId={plan.id}
          planName={plan.name}
          onClose={() => setShowExportModal(false)}
        />
      )}
      {editingRecord && (
        <EditRecordModal
          record={editingRecord}
          fields={fields}
          data={editData}
          onDataChange={updateEditField}
          onSave={saveEdit}
          onCancel={cancelEdit}
          onDelete={() => deleteRecord(editingRecord.id)}
          submitting={submitting}
          formLayoutOrder={plan?.formLayoutOrder}
        />
      )}
      {!hasFields ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-foreground/70">
            No fields configured. Edit the plan to add fields, then you can collect data.
          </p>
          {isAdmin && (
            <Link
              to={`/test-plans/${plan.id}/edit`}
              className="mt-4 inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 sm:min-h-0"
            >
              Edit plan
            </Link>
          )}
        </div>
      ) : (
        <div className="w-full min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <input
                type="search"
                placeholder="Search all columns..."
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
            {differsFromDefault && (
              <button
                type="button"
                onClick={clearToDefault}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
              >
                Clear
              </button>
            )}
            {hasActiveFilters && (
              <span className="text-sm text-foreground/60">
                {filteredRecords.length} of {sortedRecords.length} rows
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowMobileFilterPanel((s) => !s)}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-sm sm:min-h-0 md:hidden ${
                hasActiveFilters
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-foreground hover:bg-background'
              }`}
              title="Filter by column"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="text-xs">Filters</span>
            </button>
            <button
              type="button"
              onClick={() => setCompactCards((c) => !c)}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-sm sm:min-h-0 md:hidden ${
                compactCards
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-foreground hover:bg-background'
              }`}
              title={compactCards ? 'Show full cards' : 'Show compact cards (first 3 lines or until separator)'}
            >
              <span className="text-xs">Compact</span>
            </button>
            <div className="relative hidden md:block">
              <button
                ref={columnPickerAnchorRef}
                type="button"
                onClick={() => setOpenColumnPicker((o) => !o)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  visibleFields.length < fields.length
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground hover:bg-background'
                }`}
                title="Choose columns to display"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span className="text-xs">Columns</span>
              </button>
              {openColumnPicker && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden
                    onClick={() => setOpenColumnPicker(false)}
                  />
                  <div
                    className="absolute right-0 top-full z-50 mt-1 min-w-[180px] max-w-[280px] rounded-lg border border-border bg-card py-2 shadow-lg"
                    style={{ left: columnPickerAnchorRef.current ? 'auto' : 0 }}
                  >
                    <div className="border-b border-border px-3 pb-2">
                      <span className="text-sm font-medium text-foreground">Show columns</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto px-2 py-1">
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background">
                        <input type="checkbox" checked disabled className="h-4 w-4" />
                        <span className="text-sm text-foreground">Date</span>
                      </label>
                      {fields.map((f) => (
                        <label
                          key={f.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background"
                        >
                          <input
                            type="checkbox"
                            checked={!hiddenColumnKeys.includes(f.key)}
                            onChange={() => toggleColumnVisibility(f.key)}
                            className="h-4 w-4"
                          />
                          <span className="truncate text-sm text-foreground">{f.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="border-t border-border px-3 pt-2">
                      <span className="text-xs text-foreground/60">Actions always shown</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          {statusTabs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
              {statusTabs.map((tab) => {
                const tabColor = statusField?.config?.statusColors?.[tab]
                const isSelected = selectedStatusTab === tab
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSelectedStatusTab(tab)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isSelected && !tabColor
                        ? 'bg-primary text-primary-foreground'
                        : isSelected && tabColor
                          ? ''
                          : 'text-foreground/80 hover:bg-background hover:text-foreground'
                    }`}
                    style={isSelected && tabColor ? { backgroundColor: tabColor, color: '#fff' } : undefined}
                  >
                    {tab}
                  </button>
                )
              })}
            </div>
          )}
          {/* Mobile filter panel */}
          {showMobileFilterPanel && (
            <div className="rounded-lg border border-border bg-card p-3 md:hidden">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Filter by</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileFilterPanel(false)
                    setOpenFilterColumn(null)
                  }}
                  className="text-foreground/60 hover:text-foreground"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-1">
                <div
                  ref={(el) => { filterAnchorRefs.current['date'] = el }}
                  className="relative"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFilterColumn((c) => (c === 'date' ? null : 'date'))}
                    className={`flex w-full min-h-[44px] items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-background ${
                      columnFilters['date']?.size ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    <span>Date</span>
                    {columnFilters['date']?.size ? (
                      <span className="text-xs text-foreground/60">{columnFilters['date'].size} selected</span>
                    ) : (
                      <svg className="h-4 w-4 text-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>
                  {openFilterColumn === 'date' && (
                    <ColumnFilterDropdown
                      columnKey="date"
                      columnLabel="Date"
                      values={getColumnValues('date')}
                      selected={columnFilters['date'] ?? new Set()}
                      onChange={(s) => setColumnFilters((p) => ({ ...p, date: s }))}
                      onClose={() => setOpenFilterColumn(null)}
                      anchorRef={{ current: filterAnchorRefs.current['date'] }}
                    />
                  )}
                </div>
                {fields.map((f) => (
                  <div
                    key={f.id}
                    ref={(el) => { filterAnchorRefs.current[f.key] = el }}
                    className="relative"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFilterColumn((c) => (c === f.key ? null : f.key))}
                      className={`flex w-full min-h-[44px] items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-background ${
                        columnFilters[f.key]?.size ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      <span>{f.label}</span>
                      {columnFilters[f.key]?.size ? (
                        <span className="text-xs text-foreground/60">{columnFilters[f.key]!.size} selected</span>
                      ) : (
                        <svg className="h-4 w-4 text-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                    {openFilterColumn === f.key && (
                      <ColumnFilterDropdown
                        columnKey={f.key}
                        columnLabel={f.label}
                        values={getColumnValues(f.key)}
                        selected={columnFilters[f.key] ?? new Set()}
                        onChange={(s) => setColumnFilters((p) => ({ ...p, [f.key]: s }))}
                        onClose={() => setOpenFilterColumn(null)}
                        anchorRef={{ current: filterAnchorRefs.current[f.key] }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Mobile: card layout (same structure as editor) */}
          <div className="w-full min-w-0 space-y-2 md:hidden">
            {sortedRecords.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
                No data yet. Click &quot;+ Add row&quot; to add.
              </p>
            ) : filteredRecords.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
                No rows match the current filters.
              </p>
            ) : (
              filteredRecords.map((record) => {
                const cardFormOrder = statusField
                  ? normalizeFormLayoutOrder(plan?.formLayoutOrder, fields).filter((entry) => {
                      if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
                      return parseFieldEntry(entry).fieldId !== statusField.id
                    })
                  : normalizeFormLayoutOrder(plan?.formLayoutOrder, fields)
                const allFormRows = buildFormRowsFromOrder(fields, cardFormOrder)
                const { rows: formRows, truncated } = compactCards
                  ? truncateFormRowsForCompact(allFormRows, 3)
                  : { rows: allFormRows, truncated: false }
                return (
                  <div
                    key={record.id}
                    onClick={(e) => handleRowClick(record, e)}
                    className="w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-background/50 active:bg-background/70"
                  >
                    <h3 className="mb-2 truncate text-sm font-medium text-foreground/70">
                      {format(new Date(record.recordedAt), 'MM/dd/yyyy HH:mm')}
                    </h3>
                    <div className="space-y-2">
                      {formRows.map((row, ri) =>
                        Array.isArray(row) ? (
                          <div key={ri} className="flex w-full min-w-0 flex-wrap gap-x-4 gap-y-2">
                            {row.map(({ field }) => (
                              <div
                                key={field.id}
                                className="min-w-0 flex-1 basis-0 overflow-hidden"
                              >
                                <label className="mb-0.5 block truncate text-sm font-medium text-foreground">
                                  {field.label}
                                </label>
                                <p className="truncate text-sm text-foreground">
                                  {typeof record.data[field.key] === 'boolean'
                                    ? record.data[field.key]
                                      ? 'Yes'
                                      : 'No'
                                    : field.type === 'image'
                                      ? (() => {
                                          const v = record.data[field.key]
                                          const arr = Array.isArray(v) ? v : v ? [v] : []
                                          return arr.length ? `${arr.length} photo(s)` : '—'
                                        })()
                                      : field.type === 'longtext'
                                        ? (() => {
                                            const s = String(record.data[field.key] ?? '—')
                                            return s.length > 80 ? `${s.slice(0, 80)}…` : s || '—'
                                          })()
                                        : field.type === 'fraction'
                                          ? (() => {
                                              const n = Number(record.data[field.key])
                                              return n && Number.isFinite(n) ? formatDecimalAsFraction(n) : '—'
                                            })()
                                          : String(record.data[field.key] ?? '—')}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div key={ri} className="my-2 border-t-2 border-border" />
                        )
                      )}
                    </div>
                    {truncated && (
                      <p className="mt-2 text-xs text-foreground/50">… more</p>
                    )}
                    <div
                      className="mt-3 flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {statusField ? (
                        (() => {
                          const statusVal = String(record.data[statusField.key] ?? '').trim() || '(No Status)'
                          const statusColor = statusVal !== '(No Status)' ? statusField.config?.statusColors?.[statusVal] : undefined
                          return (
                            <span className="min-w-0 truncate text-sm text-foreground/70">
                              <span className="font-medium text-foreground/50">Status:</span>{' '}
                              {statusColor ? (
                                <span
                                  className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium"
                                  style={{ backgroundColor: statusColor, color: '#fff' }}
                                >
                                  {statusVal}
                                </span>
                              ) : (
                                statusVal
                              )}
                            </span>
                          )
                        })()
                      ) : null}
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(record)}
                          className="min-h-[44px] rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRecord(record.id)}
                          disabled={submitting}
                          className="min-h-[44px] rounded border border-red-500/50 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          {/* Desktop: table */}
          <div className="hidden w-full min-w-0 overflow-x-auto rounded-lg border border-border md:block">
          <table
            className="w-full"
            style={{
              tableLayout: Object.keys(fieldLayout).length > 0 ? 'fixed' : undefined,
            }}
          >
            {Object.keys(fieldLayout).length > 0 && (
              <colgroup>
                <col style={{ width: '140px' }} />
                {visibleFields.map((f) => (
                  <col key={f.id} style={{ width: fieldLayout[f.id] || 'auto' }} />
                ))}
                <col style={{ width: '100px' }} />
              </colgroup>
            )}
            <thead className="bg-card">
              <tr>
                <th
                  ref={(el) => { filterAnchorRefs.current['date'] = el }}
                  className="relative min-w-0 cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('date')}
                  title="Tap to sort. Long-press or Shift+click to add secondary sort."
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 truncate">Date</span>
                    {getSortIndex('date') >= 0 && (
                      <span className="shrink-0 text-foreground/60">
                        {getSortIndex('date') + 1}{getSortDir('date') === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setOpenFilterColumn((c) => (c === 'date' ? null : 'date')) }}
                      className={`ml-1 shrink-0 rounded p-0.5 hover:bg-background ${columnFilters['date']?.size ? 'text-primary' : 'text-foreground/50'}`}
                      title="Filter column"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                    </button>
                  </span>
                  {openFilterColumn === 'date' && (
                    <ColumnFilterDropdown
                      columnKey="date"
                      columnLabel="Date"
                      values={getColumnValues('date')}
                      selected={columnFilters['date'] ?? new Set()}
                      onChange={(s) => setColumnFilters((p) => ({ ...p, date: s }))}
                      onClose={() => setOpenFilterColumn(null)}
                      anchorRef={{ current: filterAnchorRefs.current['date'] }}
                    />
                  )}
                </th>
                {visibleFields.map((f) => (
                  <th
                    key={f.id}
                    ref={(el) => { filterAnchorRefs.current[f.key] = el }}
                    className="relative min-w-0 cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                    {...getSortHandlers(f.key)}
                    title="Tap to sort. Long-press or Shift+click to add secondary sort."
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="min-w-0 truncate">{f.label}</span>
                      {getSortIndex(f.key) >= 0 && (
                        <span className="shrink-0 text-foreground/60">
                          {getSortIndex(f.key) + 1}{getSortDir(f.key) === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenFilterColumn((c) => (c === f.key ? null : f.key)) }}
                        className={`ml-1 shrink-0 rounded p-0.5 hover:bg-background ${columnFilters[f.key]?.size ? 'text-primary' : 'text-foreground/50'}`}
                        title="Filter column"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                      </button>
                    </span>
                    {openFilterColumn === f.key && (
                      <ColumnFilterDropdown
                        columnKey={f.key}
                        columnLabel={f.label}
                        values={getColumnValues(f.key)}
                        selected={columnFilters[f.key] ?? new Set()}
                        onChange={(s) => setColumnFilters((p) => ({ ...p, [f.key]: s }))}
                        onClose={() => setOpenFilterColumn(null)}
                        anchorRef={{ current: filterAnchorRefs.current[f.key] }}
                      />
                    )}
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleFields.length + 2}
                    className="p-6 text-center text-foreground/60"
                  >
                    No data yet. Click &quot;+ Add row&quot; to add.
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleFields.length + 2}
                    className="p-6 text-center text-foreground/60"
                  >
                    No rows match the current filters.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => (
                  <tr
                    key={record.id}
                    onClick={(e) => handleRowClick(record, e)}
                    className="cursor-pointer bg-background transition-colors hover:bg-card"
                  >
                    <td className="px-4 py-3 text-sm text-foreground/70">
                      {format(new Date(record.recordedAt), 'MM/dd/yyyy HH:mm')}
                    </td>
                    {visibleFields.map((f) => (
                      <td
                        key={f.id}
                        className="px-4 py-3 text-foreground"
                        onClick={f.type === 'status' ? (e) => e.stopPropagation() : undefined}
                      >
                        {typeof record.data[f.key] === 'boolean'
                          ? record.data[f.key]
                            ? 'Yes'
                            : 'No'
                          : f.type === 'image'
                            ? (() => {
                                const v = record.data[f.key]
                                const arr = Array.isArray(v) ? v : v ? [v] : []
                                return arr.length ? `${arr.length} photo(s)` : '—'
                              })()
                            : f.type === 'longtext'
                              ? (
                                <span className="whitespace-pre-wrap break-words">
                                  {String(record.data[f.key] ?? '—')}
                                </span>
                                )
                              : f.type === 'status'
                                ? (
                                    <SelectInput
                                      value={String(record.data[f.key] ?? '')}
                                      onChange={(v) => updateRecordField(record, f.key, v)}
                                      options={getStatusOptions(f)}
                                      className="min-w-[120px] [&_button]:min-h-0 [&_button]:py-1.5"
                                      valueColor={f.config?.statusColors?.[String(record.data[f.key] ?? '')]}
                                      optionColors={f.config?.statusColors}
                                    />
                                  )
                                : f.type === 'fraction'
                                ? (() => {
                                    const n = Number(record.data[f.key])
                                    return n && Number.isFinite(n) ? formatDecimalAsFraction(n) : '—'
                                  })()
                                : f.type === 'atlas_location'
                                  ? String(record.data[f.key] ?? '—')
                                  : String(record.data[f.key] ?? '—')}
                      </td>
                    ))}
                    <td className="px-2 py-3 text-right sm:px-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(record)}
                          className="min-h-[44px] min-w-[44px] rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background sm:min-h-0 sm:min-w-0 sm:py-1"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRecord(record.id)}
                          disabled={submitting}
                          className="min-h-[44px] min-w-[44px] rounded border border-red-500/50 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50 sm:min-h-0 sm:min-w-0 sm:py-1"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
