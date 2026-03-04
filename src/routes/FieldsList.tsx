import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useSortableHeader } from '../hooks/useSortableHeader'
import type { DataField } from '../types'

type SortKey = 'key' | 'label' | 'type'
type SortLevel = { key: SortKey; dir: 'asc' | 'desc' }

export function FieldsList() {
  const [fields, setFields] = useState<DataField[]>([])
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState<SortLevel[]>([{ key: 'key', dir: 'asc' }])
  const navigate = useNavigate()

  const getVal = (f: DataField, key: SortKey) =>
    key === 'key' ? f.key : key === 'label' ? (f.label ?? '') : f.type

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
    if (!confirm(`Delete field "${key}"? This may affect tests using it.`)) return
    try {
      await api.delete(`/fields/${id}`)
      loadFields()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to delete field')
      loadFields()
    }
  }

  return (
    <div>
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
        <div className="overflow-x-auto rounded-lg border border-border">
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
                <th className="px-4 py-2 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedFields.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-foreground/60">
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
      )}
    </div>
  )
}
