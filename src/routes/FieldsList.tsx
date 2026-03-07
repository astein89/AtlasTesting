import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useSortableHeader } from '../hooks/useSortableHeader'
import { getFieldsReferencingKey } from '../utils/formulaEvaluator'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import type { DataField, TestPlan } from '../types'

type SortKey = 'key' | 'label' | 'type' | 'updatedAt'
type SortLevel = { key: SortKey; dir: 'asc' | 'desc' }

export function FieldsList() {
  const [fields, setFields] = useState<DataField[]>([])
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState<SortLevel[]>([{ key: 'key', dir: 'asc' }])
  const navigate = useNavigate()
  const { showAlert, showConfirm } = useAlertConfirm()

  const getVal = (f: DataField, key: SortKey) =>
    key === 'key'
      ? f.key
      : key === 'label'
        ? f.label ?? ''
        : key === 'updatedAt'
          ? f.updatedAt ?? f.createdAt ?? ''
          : f.type

  const sortedFields = useMemo(() => {
    const copy = [...fields]
    copy.sort((a, b) => {
      for (const { key, dir } of sortOrder) {
        const cmp = getVal(a, key).localeCompare(getVal(b, key), undefined, { sensitivity: 'base' })
        const result = dir === 'asc' ? cmp : -cmp
        if (result !== 0) return result
      }
      return 0
    })
    return copy
  }, [fields, sortOrder])

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
  const getSortIndex = (k: SortKey) => sortOrder.findIndex((s) => s.key === k)
  const getSortDir = (k: SortKey) => sortOrder.find((s) => s.key === k)?.dir

  const formatType = (f: DataField) => {
    if (f.type === 'select') {
      const opts = f.config?.options
      if (opts?.length) {
        const list = opts.length > 4 ? `${opts.slice(0, 4).join(', ')}…` : opts.join(', ')
        return `${f.type} (${list})`
      }
    }
    if (f.type === 'status') {
      return 'status (In Progress, Complete, Passed, …)'
    }
    if (f.type === 'fraction' && f.config?.fractionScale) {
      return `${f.type} (${f.config.fractionScale})`
    }
    if (f.type === 'image') {
      return f.config?.imageMultiple ? 'image (multiple)' : 'image (single)'
    }
    return f.type
  }

  const handleRowClick = (f: DataField, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    navigate(`/fields/${f.id}`)
  }

  const loadFields = useCallback(() => {
    setLoading(true)
    api
      .get<DataField[]>('/fields')
      .then((r) => setFields(r.data))
      .catch(() => setFields([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadFields()
  }, [loadFields])

  const handleDelete = async (id: string, key: string) => {
    const usedBy = getFieldsReferencingKey(key, fields.filter((f) => f.id !== id))
    if (usedBy.length > 0) {
      const names = usedBy.map((f) => f.label || f.key).join(', ')
      showAlert(
        `This field is used in the formula field(s): ${names}. Remove or update those formulas before deleting.`,
        'Cannot delete field'
      )
      return
    }
    const plansRes = await api.get<TestPlan[]>('/test-plans').catch(() => ({ data: [] as TestPlan[] }))
    const plansUsingField = (plansRes.data ?? []).filter((p) => p.fieldIds?.includes(id))
    if (plansUsingField.length > 0) {
      const names = plansUsingField.map((p) => p.name).join(', ')
      showAlert(`Cannot delete this field. It is used in the test plan(s): ${names}. Remove it from the plan(s) first.`)
      return
    }
    const ok = await showConfirm(`Delete field "${key}"?`, { title: 'Delete field' })
    if (!ok) return
    try {
      await api.delete(`/fields/${id}`)
      loadFields()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to delete field')
      loadFields()
    }
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Data Fields</h1>
        <Link
          to="/fields/new"
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
        >
          Add Field
        </Link>
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <>
          {/* Mobile: card layout */}
          <div className="w-full min-w-0 space-y-2 md:hidden">
            {sortedFields.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
                No data fields yet.
              </p>
            ) : (
              sortedFields.map((f) => (
                <div
                  key={f.id}
                  onClick={(e) => handleRowClick(f, e)}
                  className="w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-background/50 active:bg-background/70"
                >
                  <p className="truncate font-medium text-foreground">{f.key}</p>
                  <p className="mt-0.5 truncate text-sm text-foreground">{f.label}</p>
                  <p className="mt-0.5 truncate text-sm text-foreground/70">{formatType(f)}</p>
                  <p className="mt-0.5 truncate text-xs text-foreground/60">
                    {f.updatedAt
                      ? `${new Date(f.updatedAt).toLocaleDateString()}${f.updatedByName ? ` by ${f.updatedByName}` : ''}`
                      : f.createdAt
                        ? `${new Date(f.createdAt).toLocaleDateString()}${f.createdByName ? ` by ${f.createdByName}` : ''}`
                        : '—'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <Link
                      to={`/fields/${f.id}`}
                      className="min-h-[44px] flex items-center rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(f.id, f.key)}
                      className="min-h-[44px] rounded border border-red-500/50 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Desktop: table */}
          <div className="hidden w-full min-w-0 overflow-x-auto rounded-lg border border-border md:block">
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th
                  className="cursor-pointer select-none px-4 py-2 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('key')}
                  title="Tap to sort. Long-press to add secondary sort."
                >
                  Key
                  {getSortIndex('key') >= 0 && (
                    <span className="ml-1 text-foreground/60">
                      {getSortIndex('key') + 1}{getSortDir('key') === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-2 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('label')}
                  title="Tap to sort. Long-press to add secondary sort."
                >
                  Label
                  {getSortIndex('label') >= 0 && (
                    <span className="ml-1 text-foreground/60">
                      {getSortIndex('label') + 1}{getSortDir('label') === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-2 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('type')}
                  title="Tap to sort. Long-press to add secondary sort."
                >
                  Type
                  {getSortIndex('type') >= 0 && (
                    <span className="ml-1 text-foreground/60">
                      {getSortIndex('type') + 1}{getSortDir('type') === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-2 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('updatedAt')}
                  title="Tap to sort. Long-press to add secondary sort."
                >
                  Last edited
                  {getSortIndex('updatedAt') >= 0 && (
                    <span className="ml-1 text-foreground/60">
                      {getSortIndex('updatedAt') + 1}{getSortDir('updatedAt') === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th className="px-4 py-2 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedFields.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-foreground/60">
                    No data fields yet.
                  </td>
                </tr>
              ) : (
              sortedFields.map((f) => (
                <tr
                  key={f.id}
                  onClick={(e) => handleRowClick(f, e)}
                  className="cursor-pointer bg-background transition-colors hover:bg-card"
                >
                  <td className="px-4 py-2 text-foreground">{f.key}</td>
                  <td className="px-4 py-2 text-foreground">{f.label}</td>
                  <td className="px-4 py-2 text-foreground">{formatType(f)}</td>
                  <td className="px-4 py-2 text-foreground/70">
                    {f.updatedAt
                      ? `${new Date(f.updatedAt).toLocaleDateString()}${f.updatedByName ? ` by ${f.updatedByName}` : ''}`
                      : f.createdAt
                        ? `${new Date(f.createdAt).toLocaleDateString()}${f.createdByName ? ` by ${f.createdByName}` : ''}`
                        : '—'}
                  </td>
                  <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-3">
                      <Link
                        to={`/fields/${f.id}`}
                        className="text-primary hover:underline"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(f.id, f.key)}
                        className="text-red-500 hover:underline"
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
        </>
      )}
    </div>
  )
}
