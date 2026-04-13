import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, isAbortLikeError } from '../api/client'
import { useAbortableEffect } from '../hooks/useAbortableEffect'
import { useSortableHeader } from '../hooks/useSortableHeader'
import { getFieldsReferencingKey } from '../utils/formulaEvaluator'
import { anyPlanConditionalStatusRulesTouchField } from '../utils/planConditionalStatus'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { testingPath } from '../lib/appPaths'
import type { DataField, TestPlan } from '../types'

type SortKey = 'label' | 'type' | 'updatedAt'
type SortLevel = { key: SortKey; dir: 'asc' | 'desc' }

export function FieldsList() {
  const [fields, setFields] = useState<DataField[]>([])
  const [testPlans, setTestPlans] = useState<TestPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState<SortLevel[]>([{ key: 'label', dir: 'asc' }])
  const navigate = useNavigate()
  const { showAlert, showConfirm } = useAlertConfirm()

  const getVal = (f: DataField, key: SortKey) =>
    key === 'label'
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
      return `Dimension (${f.config.fractionScale})`
    }
    if (f.type === 'fraction') {
      return 'Dimension'
    }
    if (f.type === 'image') {
      return f.config?.imageMultiple ? 'image (multiple)' : 'image (single)'
    }
    return f.type
  }

  const handleRowClick = (f: DataField, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    navigate(testingPath('fields', f.id))
  }

  const plansByFieldId = useMemo(() => {
    const map = new Map<string, TestPlan[]>()
    for (const plan of testPlans) {
      const ids = plan.fieldIds ?? []
      for (const fid of ids) {
        if (!fid) continue
        const list = map.get(fid) ?? []
        list.push(plan)
        map.set(fid, list)
      }
    }
    return map
  }, [testPlans])

  const loadFields = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const [fieldList, planList] = await Promise.all([
        api.get<DataField[]>('/fields', { signal }).then((r) => r.data).catch(() => [] as DataField[]),
        api.get<TestPlan[]>('/test-plans', { signal }).then((r) => r.data).catch(() => [] as TestPlan[]),
      ])
      setFields(fieldList)
      setTestPlans(planList)
    } catch (e) {
      if (!isAbortLikeError(e)) {
        setFields([])
        setTestPlans([])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useAbortableEffect((signal) => loadFields(signal), [loadFields])

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
    const plansUsingField = testPlans.filter((p) => p.fieldIds?.includes(id))
    if (plansUsingField.length > 0) {
      const names = plansUsingField.map((p) => p.name).join(', ')
      showAlert(`Cannot delete this field. It is used in the test plan(s): ${names}. Remove it from the plan(s) first.`)
      return
    }
    if (anyPlanConditionalStatusRulesTouchField(testPlans, id, key)) {
      showAlert(
        'Cannot delete this field. It is used in test plan Status Conditionals (as the status field or in a rule formula). Remove those rules or take the field out of the plan first.'
      )
      return
    }
    const ok = await showConfirm(`Delete field "${key}"?`, { title: 'Delete field' })
    if (!ok) return
    try {
      await api.delete(`/fields/${id}`)
      loadFields()
    } catch (e: unknown) {
      const errObj = e as { response?: { status?: number; data?: { error?: string } } }
      // If the field is already gone (404), just refresh without showing an error.
      if (errObj.response?.status === 404) {
        loadFields()
        return
      }
      const err = errObj.response?.data?.error
      showAlert(err || 'Failed to delete field')
      loadFields()
    }
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Data Fields</h1>
        <Link
          to={testingPath('fields', 'new')}
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
                  <p className="flex min-w-0 flex-wrap items-center gap-2 font-medium text-foreground">
                    <span className="min-w-0 truncate">{f.label?.trim() || '—'}</span>
                    {f.ownerTestPlanId && (
                      <span className="inline-flex shrink-0 items-center rounded-full border border-yellow-500 bg-yellow-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-800 dark:border-yellow-400 dark:bg-yellow-500/20 dark:text-yellow-200">
                        Plan-specific
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-foreground/70">{formatType(f)}</p>
                  <div className="mt-0.5 min-w-0 text-xs text-foreground/70">
                    <span className="font-medium text-foreground/80">Plans: </span>
                    {(() => {
                      const direct = plansByFieldId.get(f.id) ?? []
                      const ownerPlan = f.ownerTestPlanId
                        ? testPlans.find((p) => p.id === f.ownerTestPlanId)
                        : undefined
                      const merged =
                        ownerPlan && !direct.some((p) => p.id === ownerPlan.id)
                          ? [ownerPlan, ...direct]
                          : direct
                      return merged
                    })().length ? (
                      <div className="mt-0.5 space-y-0">
                        {(() => {
                          const direct = plansByFieldId.get(f.id) ?? []
                          const ownerPlan = f.ownerTestPlanId
                            ? testPlans.find((p) => p.id === f.ownerTestPlanId)
                            : undefined
                          const merged =
                            ownerPlan && !direct.some((p) => p.id === ownerPlan.id)
                              ? [ownerPlan, ...direct]
                              : direct
                          return merged
                        })().map((p) => (
                          <div key={p.id} className="min-w-0 truncate" title={p.name}>
                            <Link
                              to={testingPath('test-plans', p.slug || p.id)}
                              className="block truncate text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {p.name}
                            </Link>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-foreground/50">—</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-foreground/60">
                    {f.updatedAt
                      ? `${new Date(f.updatedAt).toLocaleDateString()}${f.updatedByName ? ` by ${f.updatedByName}` : ''}`
                      : f.createdAt
                        ? `${new Date(f.createdAt).toLocaleDateString()}${f.createdByName ? ` by ${f.createdByName}` : ''}`
                        : '—'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <Link
                      to={testingPath('fields', f.id)}
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
          <table className="w-full table-fixed">
            <thead className="bg-card">
              <tr>
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
                <th className="w-[12rem] max-w-[14rem] px-4 py-2 text-left text-sm font-medium text-foreground">
                  Test plans
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
                  <td className="px-4 py-2 text-foreground">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0">{f.label?.trim() || '—'}</span>
                      {f.ownerTestPlanId && (
                        <span className="inline-flex shrink-0 items-center rounded-full border border-yellow-500 bg-yellow-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-800 dark:border-yellow-400 dark:bg-yellow-500/20 dark:text-yellow-200">
                          Plan-specific
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-foreground">{formatType(f)}</td>
                  <td
                    className="w-[12rem] max-w-[14rem] min-w-0 px-4 py-2 align-top text-sm text-foreground/80"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(() => {
                      const direct = plansByFieldId.get(f.id) ?? []
                      const ownerPlan = f.ownerTestPlanId
                        ? testPlans.find((p) => p.id === f.ownerTestPlanId)
                        : undefined
                      const merged =
                        ownerPlan && !direct.some((p) => p.id === ownerPlan.id)
                          ? [ownerPlan, ...direct]
                          : direct
                      return merged
                    })().length ? (
                      <ul className="list-none space-y-0">
                        {(() => {
                          const direct = plansByFieldId.get(f.id) ?? []
                          const ownerPlan = f.ownerTestPlanId
                            ? testPlans.find((p) => p.id === f.ownerTestPlanId)
                            : undefined
                          const merged =
                            ownerPlan && !direct.some((p) => p.id === ownerPlan.id)
                              ? [ownerPlan, ...direct]
                              : direct
                          return merged
                        })().map((p) => (
                          <li key={p.id} className="min-w-0 max-w-full overflow-hidden">
                            <Link
                              to={testingPath('test-plans', p.slug || p.id)}
                              className="block truncate whitespace-nowrap text-primary hover:underline"
                              title={p.name}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {p.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-foreground/50">—</span>
                    )}
                  </td>
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
                        to={testingPath('fields', f.id)}
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
