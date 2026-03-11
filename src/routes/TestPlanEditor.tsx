import { Fragment, useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { PlanFieldsEditor } from '../components/fields/PlanFieldsEditor'
import { CreateFieldForm } from '../components/fields/CreateFieldForm'
import { PopupSelect } from '../components/ui/PopupSelect'
import { SelectInput } from '../components/fields/SelectInput'
import {
  formatFieldEntry,
  getFieldIdsFromOrder,
  isSeparatorId,
  isSeparatorLineId,
  parseFieldEntry,
} from '../utils/formLayout'
import { getFormulaReferencedFieldKeys } from '../utils/formulaEvaluator'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import type { DataField, TestPlan } from '../types'
import { getStatusOptions } from '../types'

export function TestPlanEditor() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const isNew = !planId
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [testPlan, setTestPlan] = useState('')
  const [constraints, setConstraints] = useState('')
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [formLayoutOrder, setFormLayoutOrder] = useState<string[]>([])
  const [defaultSortOrder, setDefaultSortOrder] = useState<Array<{ key: string; dir: 'asc' | 'desc' }>>([
    { key: 'date', dir: 'asc' },
  ])
  const [fieldDefaults, setFieldDefaults] = useState<Record<string, string | number | boolean | string[]>>({})
  const [keyField, setKeyField] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [hiddenFieldIds, setHiddenFieldIds] = useState<string[]>([])
  const [requiredFieldIds, setRequiredFieldIds] = useState<string[]>([])
  const [planFields, setPlanFields] = useState<DataField[]>([])
  const [showCreateField, setShowCreateField] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [submitting, setSubmitting] = useState(false)
  const { showAlert, showConfirm } = useAlertConfirm()

  /** Move entries for hidden fields to the end of the form layout order. */
  function moveHiddenFieldsToEnd(order: string[], hiddenIds: string[]): string[] {
    if (hiddenIds.length === 0) return order
    const hiddenSet = new Set(hiddenIds)
    const visible: string[] = []
    const hidden: string[] = []
    for (const entry of order) {
      if (isSeparatorId(entry) || isSeparatorLineId(entry)) {
        visible.push(entry)
      } else {
        const { fieldId } = parseFieldEntry(entry)
        if (hiddenSet.has(fieldId)) hidden.push(entry)
        else visible.push(entry)
      }
    }
    return [...visible, ...hidden]
  }

  const setHiddenFieldIdsAndReorder = (ids: string[]) => {
    setHiddenFieldIds(ids)
    setFormLayoutOrder((prev) => moveHiddenFieldsToEnd(prev, ids))
  }

  useEffect(() => {
    if (!isNew && planId) {
      api
        .get<TestPlan>(`/test-plans/${planId}`)
        .then((r) => {
          setName(r.data.name)
          setDescription(r.data.description || '')
          setTestPlan(r.data.testPlan || '')
          setConstraints(r.data.constraints || '')
          setFieldIds(r.data.fieldIds || [])
          const order =
            Array.isArray(r.data.formLayoutOrder) && r.data.formLayoutOrder.length > 0
              ? r.data.formLayoutOrder
              : r.data.fieldIds || []
          const hiddenIds = r.data.hiddenFieldIds ?? []
          setFormLayoutOrder(moveHiddenFieldsToEnd(order, hiddenIds))
          setDefaultSortOrder(
            r.data.defaultSortOrder?.length ? r.data.defaultSortOrder : [{ key: 'date', dir: 'desc' }]
          )
          setFieldDefaults(r.data.fieldDefaults && typeof r.data.fieldDefaults === 'object' ? r.data.fieldDefaults : {})
          setKeyField(r.data.keyField ?? '')
          setStartDate(r.data.startDate ?? '')
          setEndDate(r.data.endDate ?? '')
          setHiddenFieldIds(hiddenIds)
          setRequiredFieldIds(r.data.requiredFieldIds ?? [])
        })
        .catch(() => navigate('/test-plans'))
        .finally(() => setLoading(false))
    }
  }, [planId, isNew, navigate])

  const handleCreateField = (newFieldId: string) => {
    api
      .get<DataField>(`/fields/${newFieldId}`)
      .then((fieldResp) => {
        const field = fieldResp.data
        const refKeys =
          field.type === 'formula' || (field.type === 'status' && field.config?.formula)
            ? getFormulaReferencedFieldKeys(field.config?.formula ?? '')
            : []
        if (refKeys.length === 0) {
          setFieldIds((ids) => [...ids, newFieldId])
          setFormLayoutOrder((order) => [...order, formatFieldEntry(newFieldId, 3)])
          setShowCreateField(false)
          return
        }
        return api.get<DataField[]>('/fields').then((allResp) => {
          const all = allResp.data
          const missingRefIds = refKeys
            .map((key) => all.find((f) => f.key === key)?.id)
            .filter(Boolean) as string[]
          setFieldIds((ids) => {
            const missing = missingRefIds.filter((id) => !ids.includes(id))
            return [...ids, ...missing, newFieldId]
          })
          setFormLayoutOrder((order) => {
            const currentIds = getFieldIdsFromOrder(order)
            const missing = missingRefIds.filter((id) => !currentIds.includes(id))
            return [
              ...order,
              ...missing.map((id) => formatFieldEntry(id, 3)),
              formatFieldEntry(newFieldId, 3),
            ]
          })
          setShowCreateField(false)
        })
      })
      .catch(() => {
        setFieldIds((ids) => [...ids, newFieldId])
        setFormLayoutOrder((order) => [...order, formatFieldEntry(newFieldId, 3)])
        setShowCreateField(false)
      })
  }

  const handleFormLayoutChange = (order: string[]) => {
    const newIds = getFieldIdsFromOrder(order)
    const removedIds = fieldIds.filter((id) => !newIds.includes(id))
    if (removedIds.length > 0) {
      for (const removedId of removedIds) {
        const removedField = planFields.find((f) => f.id === removedId)
        const removedKey = removedField?.key
        if (!removedKey) continue
        const formulaFieldsUsing = planFields.filter(
          (f) =>
            (f.type === 'formula' || (f.type === 'status' && f.config?.formula)) &&
            (f.config?.formula && getFormulaReferencedFieldKeys(f.config.formula).includes(removedKey))
        )
        if (formulaFieldsUsing.length > 0) {
          const names = formulaFieldsUsing.map((f) => f.label || f.key).join(', ')
          showAlert(`Cannot remove field "${removedField?.label ?? removedKey}": it is used in formula or status formula in: ${names}.`)
          return
        }
      }
    }
    setFormLayoutOrder(order)
    setFieldIds(newIds)
  }

  useEffect(() => {
    if (fieldIds.length === 0) {
      setPlanFields([])
      return
    }
    api
      .get<DataField[]>('/fields')
      .then((r) => {
        const all = r.data
        setPlanFields(fieldIds.map((id) => all.find((f) => f.id === id)).filter(Boolean) as DataField[])
      })
      .catch(() => setPlanFields([]))
  }, [fieldIds.join(',')])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (fieldIds.length < 1) {
      showAlert('Add at least one field to the plan before saving.')
      return
    }
    if (!keyField.trim()) {
      showAlert('Set a key field before saving.')
      return
    }
    setSubmitting(true)
    try {
      if (isNew) {
        const { data } = await api.post<{ id: string }>('/test-plans', {
          name: name.trim(),
          description: description.trim() || undefined,
          testPlan: testPlan.trim() || undefined,
          constraints: constraints.trim() || undefined,
          fieldIds,
          formLayoutOrder: formLayoutOrder.length > 0 ? formLayoutOrder : undefined,
          defaultSortOrder: defaultSortOrder.length > 0 ? defaultSortOrder : undefined,
          fieldDefaults: Object.keys(fieldDefaults).length > 0 ? fieldDefaults : undefined,
          keyField: keyField.trim() || undefined,
          startDate: startDate.trim() || undefined,
          endDate: endDate.trim() || undefined,
          hiddenFieldIds: hiddenFieldIds.length > 0 ? hiddenFieldIds : undefined,
          requiredFieldIds: requiredFieldIds.length > 0 ? requiredFieldIds : undefined,
        })
        navigate(returnTo ?? `/test-plans/${data.id}/edit`, { replace: true })
      } else {
        await api.put(`/test-plans/${planId}`, {
          name: name.trim(),
          description: description.trim() || undefined,
          testPlan: testPlan.trim() || undefined,
          constraints: constraints.trim() || undefined,
          fieldIds,
          formLayoutOrder,
          defaultSortOrder: defaultSortOrder.length > 0 ? defaultSortOrder : undefined,
          fieldDefaults: Object.keys(fieldDefaults).length > 0 ? fieldDefaults : undefined,
          keyField: keyField.trim() || undefined,
          startDate: startDate.trim() || undefined,
          endDate: endDate.trim() || undefined,
          hiddenFieldIds,
          requiredFieldIds,
        })
        navigate(returnTo ?? '/test-plans', { replace: true })
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(msg || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-foreground/60">Loading...</p>

  if (showCreateField) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Edit Test Plan</h1>
        <CreateFieldForm
          onSave={handleCreateField}
          onCancel={() => setShowCreateField(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="shrink-0 border-b border-border bg-background pb-4">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          {isNew ? 'New Test Plan' : 'Edit Test Plan'}
        </h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            form="test-plan-form"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => navigate(returnTo ?? '/test-plans')}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          {isAdmin && !isNew && (
            <button
              type="button"
              onClick={async () => {
                const ok = await showConfirm(`Delete plan "${name}"? This will also delete all data in this plan.`, { title: 'Delete plan', variant: 'danger', confirmLabel: 'Delete' })
                if (!ok) return
                try {
                  await api.delete(`/test-plans/${planId}`)
                  navigate(returnTo ?? '/test-plans', { replace: true })
                } catch (e: unknown) {
                  const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                  showAlert(err || 'Failed to delete plan')
                }
              }}
              className="rounded-lg border border-red-500/50 px-4 py-2 text-red-500 hover:bg-red-500/10"
            >
              Delete plan
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <form id="test-plan-form" onSubmit={handleSubmit} className="max-w-4xl space-y-6 py-4">
        <div>
          <label className="block text-sm font-medium text-foreground">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            placeholder="Brief summary of test plan"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-foreground">
              Test plan
            </label>
            <textarea
              value={testPlan}
              onChange={(e) => setTestPlan(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              rows={5}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">
              Test criteria
            </label>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              rows={5}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-foreground">
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">
              End date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Key field (for file naming)
          </label>
          <p className="mt-1 mb-1 text-sm text-foreground/60">
            Optional. When exporting a single record, this field&apos;s value can be used in the filename. Not unique.
          </p>
          <div className="w-full sm:w-1/2 sm:max-w-[14rem]">
            <PopupSelect
              label=""
              value={keyField}
              onChange={setKeyField}
              emptyOption="(none)"
              options={planFields.map((f) => ({ value: f.key, label: f.label }))}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Default sort order (data view)
          </label>
          <p className="mt-1 mb-2 text-sm text-foreground/60">
            Initial sort when viewing this plan&apos;s data. First row is primary, then secondary, etc.
          </p>
            <div className="mt-2 space-y-2">
            {defaultSortOrder.map((level, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-sm text-foreground/60">{i + 1}.</span>
                <div className="w-full flex-1 sm:w-1/2 sm:max-w-[14rem]">
                  <PopupSelect
                    label=""
                    value={level.key}
                    onChange={(v) =>
                      setDefaultSortOrder((prev) =>
                        prev.map((s, j) => (j === i ? { ...s, key: v } : s))
                      )
                    }
                    options={[
                      { value: 'date', label: 'Date' },
                      ...planFields.map((f) => ({ value: f.key, label: f.label })),
                    ]}
                  />
                </div>
                <PopupSelect
                  label=""
                  value={level.dir}
                  onChange={(v) =>
                    setDefaultSortOrder((prev) =>
                      prev.map((s, j) => (j === i ? { ...s, dir: v as 'asc' | 'desc' } : s))
                    )
                  }
                  options={[
                    { value: 'asc', label: '↓ Ascending' },
                    { value: 'desc', label: '↑ Descending' },
                  ]}
                />
                <button
                  type="button"
                  onClick={() =>
                    setDefaultSortOrder((prev) =>
                      prev.length > 1 ? prev.filter((_, j) => j !== i) : prev
                    )
                  }
                  className="rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background hover:text-foreground"
                  title="Remove sort"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDefaultSortOrder((prev) => [...prev, { key: 'date', dir: 'asc' }])
              }
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
            >
              + Add sort
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Data collection fields
          </label>
          <p className="mt-1 mb-2 text-sm text-foreground/60">
            Add fields, drag to reorder, and use New line or Separator to
            control layout.
          </p>
          <div className="mt-2">
            <PlanFieldsEditor
              formLayoutOrder={formLayoutOrder}
              onChange={handleFormLayoutChange}
              hiddenFieldIds={hiddenFieldIds}
              onHiddenFieldIdsChange={setHiddenFieldIdsAndReorder}
              requiredFieldIds={requiredFieldIds}
              onRequiredFieldIdsChange={setRequiredFieldIds}
              onCreateNew={() => setShowCreateField(true)}
              fieldDefaults={fieldDefaults}
              renderAbovePreview={
                planFields.length > 0 ? (
                  <div>
                    <label className="block text-sm font-medium text-foreground">
                      Default values (by test plan)
                    </label>
                    <p className="mt-1 mb-2 text-sm text-foreground/60">
                      Pre-fill when adding a new record. Leave blank to use the normal default.
                    </p>
                    <div
                      className="mt-2 grid gap-y-3 gap-x-4 rounded-lg border border-border bg-card p-3 sm:gap-y-2"
                      style={{ gridTemplateColumns: 'auto 180px auto' }}
                    >
                      {planFields.map((f) => {
                        const key = f.key
                        const val = fieldDefaults[key]
                        const setVal = (v: string | number | boolean | string[]) =>
                          setFieldDefaults((prev) => {
                            if (v === '' || v == null || (typeof v === 'number' && Number.isNaN(v))) {
                              const next = { ...prev }
                              delete next[key]
                              return next
                            }
                            return { ...prev, [key]: v }
                          })
                        return (
                          <Fragment key={f.id}>
                            <span className="truncate text-sm font-medium text-foreground">{f.label}</span>
                            <div className="min-w-0">
                              {f.type === 'number' && (
                                <input
                                  type="number"
                                  value={val === undefined || val === '' ? '' : Number(val)}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setVal(v === '' ? '' : parseFloat(v))
                                  }}
                                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                                  placeholder="(none)"
                                />
                              )}
                              {(f.type === 'text' || f.type === 'longtext') && (
                                <input
                                  type="text"
                                  value={val === undefined ? '' : String(val)}
                                  onChange={(e) => setVal(e.target.value)}
                                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                                  placeholder="(none)"
                                />
                              )}
                              {f.type === 'boolean' && (
                                <label className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={val === true}
                                    onChange={(e) => setVal(e.target.checked)}
                                    className="h-4 w-4"
                                  />
                                  <span className="text-sm text-foreground/70">Default checked</span>
                                </label>
                              )}
                              {f.type === 'select' && (
                                <SelectInput
                                  value={val === undefined ? '' : String(val)}
                                  onChange={(v) => setVal(v)}
                                  options={f.config?.options || []}
                                  placeholder="(none)"
                                  className="w-full"
                                />
                              )}
                              {f.type === 'status' && (
                                <SelectInput
                                  value={val === undefined ? '' : String(val)}
                                  onChange={(v) => setVal(v)}
                                  options={getStatusOptions(f)}
                                  placeholder="(none)"
                                  className="w-full"
                                />
                              )}
                              {!['number', 'text', 'longtext', 'boolean', 'select', 'status'].includes(f.type) && (
                                <input
                                  type="text"
                                  value={val === undefined ? '' : String(val)}
                                  onChange={(e) => setVal(e.target.value)}
                                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                                  placeholder="(none)"
                                />
                              )}
                            </div>
                            <div className="flex items-center justify-end gap-4">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={requiredFieldIds.includes(f.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRequiredFieldIds((prev) =>
                                        prev.includes(f.id) ? prev : [...prev, f.id]
                                      )
                                    } else {
                                      setRequiredFieldIds((prev) => prev.filter((id) => id !== f.id))
                                    }
                                  }}
                                  className="h-4 w-4"
                                />
                                <span className="text-sm text-foreground/70">Required</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={hiddenFieldIds.includes(f.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setHiddenFieldIdsAndReorder(
                                        hiddenFieldIds.includes(f.id)
                                          ? hiddenFieldIds
                                          : [...hiddenFieldIds, f.id]
                                      )
                                    } else {
                                      setHiddenFieldIdsAndReorder(
                                        hiddenFieldIds.filter((id) => id !== f.id)
                                      )
                                    }
                                  }}
                                  className="h-4 w-4"
                                />
                                <span className="text-sm text-foreground/70">Hidden</span>
                              </label>
                            </div>
                          </Fragment>
                        )
                      })}
                    </div>
                  </div>
                ) : null
              }
            />
          </div>
        </div>
        </form>
      </div>
    </div>
  )
}
