import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSortableHeader } from '../hooks/useSortableHeader'
import { format } from 'date-fns'
import { api } from '../api/client'
import { formatDecimalAsFraction } from '../utils/fraction'
import { useAuthStore } from '../store/authStore'
import { EditRecordModal } from '../components/data/EditRecordModal'
import { AddRecordModal } from '../components/data/AddRecordModal'
import { ExportPlanModal } from '../components/plan/ExportPlanModal'
import type { DataField, Test, TestPlan } from '../types'

interface Record {
  id: string
  testId: string
  testName: string
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
    else if (f.type === 'atlas_location') out[f.key] = ''
    else if (f.type === 'image') out[f.key] = f.config?.imageMultiple ? [] : ''
    else out[f.key] = ''
  }
  return out
}

export function TestData() {
  const { id } = useParams<{ id: string }>()
  const [test, setTest] = useState<Test | null>(null)
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
  const isAdmin = useAuthStore((s) => s.isAdmin())

  const loadRecords = () => {
    if (!id) return
    api
      .get<Record[]>('/records', { params: { testId: id, limit: 100 } })
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]))
  }

  useEffect(() => {
    if (id) {
      api
        .get<Test>(`/tests/${id}`)
        .then((r) => {
          setTest(r.data)
          return Promise.all(
            r.data.fieldIds.map((fid) =>
              api.get<DataField>(`/fields/${fid}`).then((fr) => fr.data)
            )
          ).then((fieldsList) =>
            api
              .get<TestPlan>(`/test-plans/${r.data.testPlanId}`)
              .then((pr) => [fieldsList, pr.data] as const)
              .catch(() => [fieldsList, null] as const)
          )
        })
        .then(([fieldsList, planData]) => {
          const fieldIdsToUse = planData?.fieldIds?.length
            ? planData.fieldIds
            : (fieldsList as DataField[]).map((f) => f.id)
          if (planData?.fieldIds?.length) {
            return Promise.all(
              planData.fieldIds.map((fid: string) =>
                api.get<DataField>(`/fields/${fid}`).then((fr) => fr.data)
              )
            ).then((f) => {
              setFields(f)
              setPlan(planData)
              setAddData(getDefaultData(f))
            })
          }
          setFields(fieldsList as DataField[])
          setPlan(planData)
          setAddData(getDefaultData(fieldsList as DataField[]))
        })
        .catch(() => setTest(null))
        .finally(() => setLoading(false))
    }
  }, [id])

  useEffect(() => {
    if (id) loadRecords()
  }, [id])

  const startAdd = () => {
    setIsAdding(true)
    setAddData(getDefaultData(fields))
  }

  const cancelAdd = () => setIsAdding(false)

  const saveAdd = async () => {
    if (!id) return
    setSubmitting(true)
    try {
      await api.post('/records', { testId: id, data: addData, status: 'pass' })
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
    setSubmitting(true)
    try {
      await api.put(`/records/${editingId}`, { data: editData, status: 'pass' })
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

  const fieldLayout = plan?.fieldLayout ?? {}
  const editingRecord = records.find((r) => r.id === editingId)

  type SortKey = 'date' | string
  type SortLevel = { key: SortKey; dir: 'asc' | 'desc' }
  const [sortOrder, setSortOrder] = useState<SortLevel[]>([{ key: 'date', dir: 'desc' }])

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

  if (loading || !test) return <p className="text-foreground/60">Loading...</p>

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            to="/test-plans"
            className="mb-2 flex min-h-[44px] w-fit items-center text-sm text-foreground/60 hover:text-foreground sm:min-h-0"
          >
            ← Back to plans
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">Data: {test.name}</h1>
          {(plan?.constraints || plan?.description) && (
            <div className="mt-2 space-y-1 text-sm text-foreground/70">
              {plan.constraints && (
                <p>
                  <span className="font-medium text-foreground/80">Constraints:</span> {plan.constraints}
                </p>
              )}
              {plan.description && (
                <p>
                  <span className="font-medium text-foreground/80">Test plan:</span> {plan.description}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {plan && (
            <>
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
            </>
          )}
          <button
            type="button"
            onClick={startAdd}
            className="min-h-[44px] shrink-0 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 sm:min-h-0"
          >
            + Add row
          </button>
        </div>
      </div>
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
      {plan && showExportModal && (
        <ExportPlanModal
          planId={plan.id}
          planName={plan.name}
          testId={test.id}
          testName={test.name}
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
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full"
          style={{
            tableLayout: Object.keys(fieldLayout).length > 0 ? 'fixed' : undefined,
          }}
        >
          {Object.keys(fieldLayout).length > 0 && (
            <colgroup>
              <col style={{ width: '140px' }} />
              {fields.map((f) => (
                <col key={f.id} style={{ width: fieldLayout[f.id] || 'auto' }} />
              ))}
              <col style={{ width: '100px' }} />
            </colgroup>
          )}
          <thead className="bg-card">
            <tr>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                {...getSortHandlers('date')}
                title="Tap to sort. Long-press or Shift+click to add secondary sort."
              >
                <span className="flex items-center gap-1">
                  Date
                  {getSortIndex('date') >= 0 && (
                    <span className="text-foreground/60">
                      {getSortIndex('date') + 1}{getSortDir('date') === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </span>
              </th>
              {fields.map((f) => (
                <th
                  key={f.id}
                  className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers(f.key)}
                  title="Tap to sort. Long-press or Shift+click to add secondary sort."
                >
                  <span className="flex items-center gap-1">
                    {f.label}
                    {getSortIndex(f.key) >= 0 && (
                      <span className="text-foreground/60">
                        {getSortIndex(f.key) + 1}{getSortDir(f.key) === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
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
                  colSpan={fields.length + 2}
                  className="p-6 text-center text-foreground/60"
                >
                  No data yet. Click &quot;+ Add row&quot; to add.
                </td>
              </tr>
            ) : (
              sortedRecords.map((record) => (
                <tr
                  key={record.id}
                  onClick={(e) => handleRowClick(record, e)}
                  className="cursor-pointer bg-background transition-colors hover:bg-card"
                >
                  <td className="px-4 py-3 text-sm text-foreground/70">
                    {format(new Date(record.recordedAt), 'MM/dd/yyyy HH:mm')}
                  </td>
                  {fields.map((f) => (
                    <td key={f.id} className="px-4 py-3 text-foreground">
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
                            : f.type === 'fraction'
                              ? formatDecimalAsFraction(Number(record.data[f.key]) || 0)
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
  )
}
