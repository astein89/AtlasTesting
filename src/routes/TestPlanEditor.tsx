import { Fragment, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { PlanFieldsEditor } from '../components/fields/PlanFieldsEditor'
import { CreateFieldForm } from '../components/fields/CreateFieldForm'
import { DraggableOptionList } from '../components/ui/DraggableOptionList'
import { PopupSelect } from '../components/ui/PopupSelect'
import { SelectInput } from '../components/fields/SelectInput'
import { AtlasLocationInput } from '../components/fields/AtlasLocationInput'
import { FormulaEditorModal } from '../components/fields/FormulaEditorModal'
import {
  formatFieldEntry,
  getFieldIdsFromOrder,
  isSeparatorId,
  isSeparatorLineId,
  parseFieldEntry,
} from '../utils/formLayout'
import { getFormulaReferencedFieldKeys } from '../utils/formulaEvaluator'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import type {
  ConditionalFormatRule,
  ConditionalStatusOptionCondition,
  ConditionalStatusStandardClause,
  DataField,
  TestPlan,
  TimerValue,
} from '../types'
import { getStatusOptions } from '../types'
import {
  isPendingStatusConditionalRow,
  makePendingStatusConditionalRowId,
  normalizeStatusStandardClauses,
  planConditionalRulesReferenceFieldKey,
} from '../utils/planConditionalStatus'

const CELL_STANDARD_OP_OPTIONS: Array<{
  value: NonNullable<ConditionalFormatRule['standardOp']>
  label: string
}> = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equal' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'between', label: 'between (numbers)' },
  { value: 'contains', label: 'contains text' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'begins_with', label: 'begins with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'blank', label: 'is blank' },
  { value: 'not_blank', label: 'is not blank' },
]

function sortStatusLabelsByFieldOrder(labels: string[], pool: string[]): string[] {
  const rank = new Map(pool.map((l, i) => [l, i]))
  return [...labels].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9))
}

/** Row labels for the Status Conditionals table: explicit plan order, or legacy keys from rules only. */
function statusConditionalRowItems(
  field: DataField,
  rules: TestPlan['conditionalStatusRules'] | undefined,
  orderByField: Record<string, string[]>
): string[] {
  const pool = getStatusOptions(field)
  const pinned = orderByField[field.id]
  const map = rules?.[field.id]
  if (pinned !== undefined) {
    return pinned.filter((l) => pool.includes(l) || isPendingStatusConditionalRow(l))
  }
  return sortStatusLabelsByFieldOrder(Object.keys(map ?? {}), pool)
}

export function TestPlanEditor() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const navState = (location.state as { returnTo?: string; createdInline?: boolean; newFieldId?: string } | null) ?? {}
  const returnTo = navState.returnTo
  const [createdInline] = useState<boolean>(navState.createdInline === true)
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const isNew = !planId
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [testPlan, setTestPlan] = useState('')
  const [constraints, setConstraints] = useState('')
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [formLayoutOrder, setFormLayoutOrder] = useState<string[]>([])
  const [defaultSortOrder, setDefaultSortOrder] = useState<Array<{ key: string; dir: 'asc' | 'desc' }>>([
    { key: 'date', dir: 'asc' },
  ])
  const [fieldDefaults, setFieldDefaults] = useState<
    Record<string, string | number | boolean | string[] | TimerValue>
  >({})
  const [keyField, setKeyField] = useState<string>('')
  const [hiddenFieldIds, setHiddenFieldIds] = useState<string[]>([])
  const [defaultVisibleColumnIds, setDefaultVisibleColumnIds] = useState<string[]>([])
  const [requiredFieldIds, setRequiredFieldIds] = useState<string[]>([])
  const [conditionalStatusRules, setConditionalStatusRules] = useState<TestPlan['conditionalStatusRules']>({})
  const [conditionalStatusRuleOrder, setConditionalStatusRuleOrder] = useState<Record<string, string[]>>({})
  const [statusAutomationHelpOpen, setStatusAutomationHelpOpen] = useState(false)
  const [statusConditionalFormulaModal, setStatusConditionalFormulaModal] = useState<{
    fieldId: string
    optionLabel: string
  } | null>(null)
  const [planFields, setPlanFields] = useState<DataField[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [submitting, setSubmitting] = useState(false)
  const { showAlert, showConfirm } = useAlertConfirm()
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const handledNewFieldIdRef = useRef<string | null>(null)

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
    if (!planId) return
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
        setFieldDefaults(
          r.data.fieldDefaults && typeof r.data.fieldDefaults === 'object' ? r.data.fieldDefaults : {}
        )
        setKeyField(r.data.keyField ?? '')
        setHiddenFieldIds(hiddenIds)
        setRequiredFieldIds(r.data.requiredFieldIds ?? [])
        setDefaultVisibleColumnIds(r.data.defaultVisibleColumnIds ?? [])
        setConditionalStatusRules(r.data.conditionalStatusRules ?? {})
        setConditionalStatusRuleOrder(r.data.conditionalStatusRuleOrder ?? {})
        if (!r.data.name) {
          // New/unnamed plan: focus name field
          setTimeout(() => {
            nameInputRef.current?.focus()
            nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 0)
        }
      })
      .catch(() => navigate('/test-plans'))
      .finally(() => setLoading(false))
  }, [planId, navigate])

  // When returning from FieldEditor after creating a new field for this plan,
  // wire the new field into the plan layout. Guard against React StrictMode
  // double-invoking effects in dev by tracking the last handled id.
  useEffect(() => {
    const newFieldId = navState.newFieldId || params.get('newFieldId') || undefined
    if (!newFieldId) return
    if (handledNewFieldIdRef.current === newFieldId) return
    handledNewFieldIdRef.current = newFieldId
    // Clear newFieldId from navigation state only after wiring completes.
    // In dev/StrictMode, effects can be mounted/unmounted quickly; clearing too early can
    // prevent the async setState from landing on the instance that remains.
    void handleCreateField(newFieldId).finally(() => {
      navigate(location.pathname, {
        replace: true,
        state: { returnTo, createdInline },
      })
    })
  }, [navState.newFieldId])

  useEffect(() => {
    if (nameError && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [nameError])

  const handleCreateField = (newFieldId: string): Promise<void> => {
    return new Promise((resolve) => {
    api
      .get<DataField>(`/fields/${newFieldId}`)
      .then((fieldResp) => {
        const field = fieldResp.data
        const refKeys =
          field.type === 'formula' || (field.type === 'status' && field.config?.formula)
            ? getFormulaReferencedFieldKeys(field.config?.formula ?? '')
            : []
        if (refKeys.length === 0) {
          // Simple path: just add the new field to the plan's field list.
          setFieldIds((ids) => (ids.includes(newFieldId) ? ids : [...ids, newFieldId]))
          resolve()
          return
        }
        return api.get<DataField[]>('/fields').then((allResp) => {
          const all = allResp.data
          const missingRefIds = refKeys
            .map((key) => all.find((f) => f.key === key)?.id)
            .filter(Boolean) as string[]
          setFieldIds((ids) => {
            const missing = missingRefIds.filter((id) => !ids.includes(id))
            // Ensure referenced fields and the new field are available in the plan,
            // but let the user place them in the form layout manually.
            const base = ids.includes(newFieldId) ? ids : [...ids, newFieldId]
            return [...base, ...missing]
          })
          resolve()
        })
      })
      .catch(() => {
        setFieldIds((ids) => (ids.includes(newFieldId) ? ids : [...ids, newFieldId]))
        resolve()
      })
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
        if (planConditionalRulesReferenceFieldKey(conditionalStatusRules, removedKey)) {
          showAlert(
            `Cannot remove field "${removedField?.label ?? removedKey}": it is referenced in Status Conditionals rule formulas. Remove or edit those rules first.`
          )
          return
        }
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
      setConditionalStatusRules((prev) => {
        const next = { ...(prev ?? {}) }
        for (const rid of removedIds) delete next[rid]
        return next
      })
      setConditionalStatusRuleOrder((prev) => {
        const next = { ...prev }
        for (const rid of removedIds) delete next[rid]
        return next
      })
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
    if (!name.trim()) {
      setNameError('Name must be entered')
      return
    }
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
          hiddenFieldIds: hiddenFieldIds.length > 0 ? hiddenFieldIds : undefined,
          requiredFieldIds: requiredFieldIds.length > 0 ? requiredFieldIds : undefined,
          defaultVisibleColumnIds:
            defaultVisibleColumnIds.length > 0 ? defaultVisibleColumnIds : undefined,
          conditionalStatusRules:
            conditionalStatusRules && Object.keys(conditionalStatusRules).length > 0
              ? conditionalStatusRules
              : undefined,
          conditionalStatusRuleOrder:
            Object.keys(conditionalStatusRuleOrder).length > 0 ? conditionalStatusRuleOrder : undefined,
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
          hiddenFieldIds,
          requiredFieldIds,
          defaultVisibleColumnIds,
          conditionalStatusRules,
          conditionalStatusRuleOrder,
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

  if (!planId && loading) return <p className="text-foreground/60">Loading…</p>

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
            onClick={async () => {
              if (createdInline && planId) {
                try {
                  await api.delete(`/test-plans/${planId}`)
                } catch {
                  // Ignore delete errors on cancel; still navigate away
                }
              }
              navigate(returnTo ?? '/test-plans')
            }}
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
            ref={nameInputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError(null)
            }}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          />
          {nameError && <p className="mt-1 text-sm text-red-500">{nameError}</p>}
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
            Default table columns (data view)
          </label>
          <p className="mt-1 mb-2 text-sm text-foreground/60">
            Which fields are shown by default in the data table. Users can change their own view; the
            Clear button resets back to this selection. Hidden fields are listed but off by default.
          </p>
          <div className="mt-2 grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
            {planFields.map((f) => {
              const isHidden = hiddenFieldIds.includes(f.id)
              const isChecked = defaultVisibleColumnIds.length
                ? defaultVisibleColumnIds.includes(f.id)
                : !isHidden
              return (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={isChecked}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setDefaultVisibleColumnIds((prev) => {
                        // When first editing, seed from current implicit default if prev empty
                        const base =
                          prev.length === 0
                            ? planFields
                                .filter((pf) => !hiddenFieldIds.includes(pf.id))
                                .map((pf) => pf.id)
                            : prev
                        if (checked) {
                          return base.includes(f.id) ? base : [...base, f.id]
                        }
                        return base.filter((id) => id !== f.id)
                      })
                    }}
                  />
                  <span className="truncate text-sm text-foreground">
                    {f.label}
                    {isHidden && <span className="ml-1 text-xs text-foreground/50">(hidden)</span>}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
        {planFields.some((f) => f.type === 'status' && !f.config?.formula) && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Status Conditionals</h3>
              <button
                type="button"
                onClick={() => setStatusAutomationHelpOpen(true)}
                className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-card"
                title="How Status Conditionals work"
              >
                How it works
              </button>
            </div>
            {statusAutomationHelpOpen && (
              <div
                className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
                onClick={() => setStatusAutomationHelpOpen(false)}
              >
                <div
                  className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <h4 className="text-base font-semibold text-foreground">Status Conditionals</h4>
                    <button
                      type="button"
                      onClick={() => setStatusAutomationHelpOpen(false)}
                      className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                    >
                      Close
                    </button>
                  </div>
                  <div className="space-y-3 text-sm text-foreground/80">
                    <p>
                      Use <strong>+ Add status</strong> to add a row, then choose the status and set a condition. The{' '}
                      <strong>first</strong> row in the table whose condition matches wins; lower rows are ignored for that
                      record.
                    </p>
                    <p>
                      <strong>Cell value</strong> rules compare column(s) on the same record. Use <strong>+ Add condition line</strong>{' '}
                      (on the right of the first line) for more checks. Each extra line starts with <strong>And</strong> or{' '}
                      <strong>Or</strong> to say how it combines with the lines above (left-to-right).
                    </p>
                    <p>
                      Use the <strong>⋮⋮</strong> handle to drag rows—top = highest priority. Row order is stored on this test
                      plan only (it does not change option order in Field Editor).
                    </p>
                    <p>
                      Define status <strong>labels</strong> in <strong>Field Editor</strong>. This table only picks which of
                      those values participate in Status Conditionals and in what order.
                    </p>
                    <p>
                      Options with <strong>no condition</strong> here are never set by Status Conditionals.
                    </p>
                    <p>
                      If the user sets a status that <strong>disagrees</strong> with Status Conditionals, it stays until they
                      clear it or choose a value that matches the current rules; clearing status removes the lock so Status
                      Conditionals can run again. Matching Status Conditionals (including re-saving the same value) keeps the row
                      unlocked so a higher-priority option can take over when its condition becomes true.
                    </p>
                    <p>
                      Status fields with a <strong>computed formula</strong> on the field do not use Status Conditionals here.
                      When <strong>no rule matches</strong>, the stored status is left unchanged.
                    </p>
                  </div>
                  <div className="mt-5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setStatusAutomationHelpOpen(false)}
                      className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
                    >
                      Got it
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-6">
              {planFields
                .filter((f) => f.type === 'status' && !f.config?.formula)
                .map((sf) => {
                  const rowItems = statusConditionalRowItems(sf, conditionalStatusRules, conditionalStatusRuleOrder)
                  const pool = getStatusOptions(sf)
                  return (
                  <div key={sf.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-2 text-sm font-medium text-foreground">{sf.label}</div>
                    <DraggableOptionList
                      items={rowItems}
                      onReorder={(items) =>
                        setConditionalStatusRuleOrder((prev) => ({ ...prev, [sf.id]: items }))
                      }
                      onAdd={() => {
                        const assigned = new Set(
                          rowItems.filter((l) => !isPendingStatusConditionalRow(l))
                        )
                        if (assigned.size >= pool.length) {
                          showAlert('Every status for this field is already in the list.')
                          return
                        }
                        setConditionalStatusRuleOrder((prev) => ({
                          ...prev,
                          [sf.id]: [...rowItems, makePendingStatusConditionalRowId()],
                        }))
                      }}
                      addLabel="+ Add status"
                      listClassName="border-border/80 bg-background/30"
                      renderRow={(opt, i) => {
                        const cond = conditionalStatusRules?.[sf.id]?.[opt] as
                          | ConditionalStatusOptionCondition
                          | null
                          | undefined
                        const uiMode: 'none' | 'formula' | 'standard' = (() => {
                          if (!cond) return 'none'
                          if (cond.mode === 'formula') return 'formula'
                          if (
                            cond.mode === 'standard' &&
                            (cond.standardClauses?.length || cond.standardOp)
                          ) {
                            return 'standard'
                          }
                          return 'none'
                        })()

                        const setRule = (next: ConditionalStatusOptionCondition | null) => {
                          setConditionalStatusRules((prev) => {
                            const p = { ...(prev ?? {}) }
                            const inner = { ...(p[sf.id] ?? {}) }
                            if (next == null) delete inner[opt]
                            else inner[opt] = next
                            if (Object.keys(inner).length === 0) delete p[sf.id]
                            else p[sf.id] = inner
                            return p
                          })
                        }

                        const clauses = normalizeStatusStandardClauses(cond, sf.key)
                        const commitStandard = (next: ConditionalStatusStandardClause[]) =>
                          setRule({ mode: 'standard', standardClauses: next })

                        const pendingRow = isPendingStatusConditionalRow(opt)
                        const usedElsewhere = new Set<string>()
                        rowItems.forEach((s, idx) => {
                          if (idx !== i && s && !isPendingStatusConditionalRow(s)) usedElsewhere.add(s)
                        })
                        const statusChoices = pool.filter((s) => s === opt || !usedElsewhere.has(s))

                        return (
                          <div className="flex flex-col gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <select
                                value={pendingRow ? '' : opt}
                                onChange={(e) => {
                                  const newLabel = e.target.value
                                  if (pendingRow) {
                                    if (!newLabel) return
                                    if (rowItems.some((l, j) => l === newLabel && j !== i)) {
                                      showAlert('That status is already in the list.')
                                      return
                                    }
                                    setConditionalStatusRuleOrder((prev) => ({
                                      ...prev,
                                      [sf.id]: rowItems.map((l, j) => (j === i ? newLabel : l)),
                                    }))
                                    return
                                  }
                                  if (newLabel === opt) return
                                  if (rowItems.some((l, j) => l === newLabel && j !== i)) {
                                    showAlert('That status is already in the list.')
                                    return
                                  }
                                  setConditionalStatusRuleOrder((prev) => ({
                                    ...prev,
                                    [sf.id]: rowItems.map((l, j) => (j === i ? newLabel : l)),
                                  }))
                                  setConditionalStatusRules((prev) => {
                                    const p = { ...(prev ?? {}) }
                                    const inner = { ...(p[sf.id] ?? {}) }
                                    const c = inner[opt]
                                    delete inner[opt]
                                    if (c != null) inner[newLabel] = c
                                    if (Object.keys(inner).length === 0) delete p[sf.id]
                                    else p[sf.id] = inner
                                    return p
                                  })
                                }}
                                className="min-w-0 flex-1 basis-[10rem] rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                                aria-label="Status"
                              >
                                {pendingRow && (
                                  <option value="">
                                    Select status…
                                  </option>
                                )}
                                {statusChoices.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={uiMode}
                                disabled={pendingRow}
                                title={pendingRow ? 'Choose a status first' : undefined}
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (v === 'none') setRule(null)
                                  else if (v === 'formula') setRule({ mode: 'formula', formula: cond?.formula ?? '' })
                                  else
                                    setRule({
                                      mode: 'standard',
                                      standardClauses: [
                                        { fieldKey: sf.key, op: 'eq', value: '' },
                                      ],
                                    })
                                }}
                                className="min-w-0 flex-1 basis-[12rem] rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                                aria-label="Conditional type"
                              >
                                <option value="none">No conditional</option>
                                <option value="formula">Formula (row)</option>
                                <option value="standard">Cell value</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  setConditionalStatusRuleOrder((prev) => ({
                                    ...prev,
                                    [sf.id]: rowItems.filter((_, j) => j !== i),
                                  }))
                                  setConditionalStatusRules((prev) => {
                                    const p = { ...(prev ?? {}) }
                                    const inner = { ...(p[sf.id] ?? {}) }
                                    delete inner[opt]
                                    if (Object.keys(inner).length === 0) delete p[sf.id]
                                    else p[sf.id] = inner
                                    return p
                                  })
                                }}
                                className="shrink-0 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                              >
                                Remove
                              </button>
                            </div>
                            {(uiMode === 'formula' || uiMode === 'standard') && (
                            <div className="min-w-0 space-y-2">
                              {uiMode === 'formula' && (
                                <div className="min-w-0 space-y-2">
                                  <p className="text-xs text-foreground/60">
                                    Row matches when this formula evaluates to true. Use [fieldKey] to reference plan fields.
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <pre className="min-h-9 flex-1 overflow-auto rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm text-foreground whitespace-pre-wrap break-all">
                                      {(cond?.formula ?? '').trim() || '(no formula)'}
                                    </pre>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStatusConditionalFormulaModal({
                                          fieldId: sf.id,
                                          optionLabel: opt,
                                        })
                                      }
                                      className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                                    >
                                      Edit formula
                                    </button>
                                  </div>
                                </div>
                              )}
                              {uiMode === 'standard' && (
                                <div className="min-w-0 space-y-2">
                                  {clauses.map((clause, ci) => (
                                    <div
                                      key={ci}
                                      className="flex flex-wrap items-center gap-2 border-border/50 border-b border-dashed pb-2 last:mb-0 last:border-0 last:pb-0"
                                    >
                                      {ci > 0 && (
                                        <select
                                          value={clause.combine === 'or' ? 'or' : 'and'}
                                          onChange={(e) => {
                                            const next = clauses.map((c, j) =>
                                              j === ci
                                                ? {
                                                    ...c,
                                                    combine: e.target.value === 'or' ? 'or' : 'and',
                                                  }
                                                : c
                                            )
                                            commitStandard(next)
                                          }}
                                          className="shrink-0 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground"
                                          aria-label={`Combine with previous (line ${ci + 1})`}
                                        >
                                          <option value="and">And</option>
                                          <option value="or">Or</option>
                                        </select>
                                      )}
                                      <span className="w-5 shrink-0 text-xs text-foreground/60">
                                        {ci === 0 ? 'If' : ''}
                                      </span>
                                      <select
                                        value={clause.fieldKey}
                                        onChange={(e) => {
                                          const next = clauses.map((c, j) =>
                                            j === ci ? { ...c, fieldKey: e.target.value } : c
                                          )
                                          commitStandard(next)
                                        }}
                                        className="max-w-[13rem] min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                                        aria-label={`Plan field (line ${ci + 1})`}
                                      >
                                        {clause.fieldKey &&
                                          !planFields.some((f) => f.key === clause.fieldKey) && (
                                            <option value={clause.fieldKey}>
                                              (not in plan) {clause.fieldKey}
                                            </option>
                                          )}
                                        {planFields.map((f) => (
                                          <option key={f.id} value={f.key}>
                                            {f.label}
                                          </option>
                                        ))}
                                      </select>
                                      <select
                                        value={clause.op ?? 'eq'}
                                        onChange={(e) => {
                                          const next = clauses.map((c, j) =>
                                            j === ci
                                              ? {
                                                  ...c,
                                                  op: e.target.value as ConditionalFormatRule['standardOp'],
                                                }
                                              : c
                                          )
                                          commitStandard(next)
                                        }}
                                        className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                                        aria-label={`Operator (line ${ci + 1})`}
                                      >
                                        {CELL_STANDARD_OP_OPTIONS.map(({ value, label }) => (
                                          <option key={value} value={value}>
                                            {label}
                                          </option>
                                        ))}
                                      </select>
                                      {clause.op !== 'blank' &&
                                        clause.op !== 'not_blank' &&
                                        clause.op !== 'between' && (
                                          <input
                                            type="text"
                                            value={clause.value ?? ''}
                                            onChange={(e) => {
                                              const next = clauses.map((c, j) =>
                                                j === ci ? { ...c, value: e.target.value } : c
                                              )
                                              commitStandard(next)
                                            }}
                                            className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                                            placeholder="Value"
                                          />
                                        )}
                                      {clause.op === 'between' && (
                                        <>
                                          <input
                                            type="text"
                                            value={clause.value ?? ''}
                                            onChange={(e) => {
                                              const next = clauses.map((c, j) =>
                                                j === ci
                                                  ? { ...c, op: 'between', value: e.target.value }
                                                  : c
                                              )
                                              commitStandard(next)
                                            }}
                                            className="w-20 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                                            placeholder="Min"
                                          />
                                          <span>–</span>
                                          <input
                                            type="text"
                                            value={clause.value2 ?? ''}
                                            onChange={(e) => {
                                              const next = clauses.map((c, j) =>
                                                j === ci
                                                  ? {
                                                      ...c,
                                                      op: 'between',
                                                      value: clause.value ?? '',
                                                      value2: e.target.value,
                                                    }
                                                  : c
                                              )
                                              commitStandard(next)
                                            }}
                                            className="w-20 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                                            placeholder="Max"
                                          />
                                        </>
                                      )}
                                      {clauses.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const filt = clauses.filter((_, j) => j !== ci)
                                            const next = filt.map((c, j) => ({
                                              ...c,
                                              combine:
                                                j === 0
                                                  ? undefined
                                                  : c.combine === 'or'
                                                    ? 'or'
                                                    : 'and',
                                            }))
                                            commitStandard(next)
                                          }}
                                          className="shrink-0 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                                        >
                                          Remove line
                                        </button>
                                      )}
                                      {ci === 0 && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            commitStandard([
                                              ...clauses,
                                              {
                                                combine: 'and',
                                                fieldKey: planFields[0]?.key ?? sf.key,
                                                op: 'eq',
                                                value: '',
                                              },
                                            ])
                                          }
                                          className="ml-auto shrink-0 rounded border border-border border-dashed bg-background/50 px-2 py-1 text-xs font-medium text-foreground hover:bg-background"
                                        >
                                          + Add condition line
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            )}
                          </div>
                        )
                      }}
                    />
                  </div>
                  )
                })}
            </div>
          </div>
        )}
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
              planId={planId ?? undefined}
              onCreateNew={async () => {
                if (!planId) {
                  if (!name.trim()) {
                    setNameError('Name must be entered')
                    return
                  }
                  // First create the plan, then go to FieldEditor with context
                  try {
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
                      hiddenFieldIds: hiddenFieldIds.length > 0 ? hiddenFieldIds : undefined,
                      requiredFieldIds: requiredFieldIds.length > 0 ? requiredFieldIds : undefined,
                      defaultVisibleColumnIds:
                        defaultVisibleColumnIds.length > 0 ? defaultVisibleColumnIds : undefined,
                      conditionalStatusRules:
                        conditionalStatusRules && Object.keys(conditionalStatusRules).length > 0
                          ? conditionalStatusRules
                          : undefined,
                      conditionalStatusRuleOrder:
                        Object.keys(conditionalStatusRuleOrder).length > 0
                          ? conditionalStatusRuleOrder
                          : undefined,
                    })
                    navigate('/fields/new', {
                      replace: true,
                      state: {
                        fromPlan: true,
                        ownerTestPlanId: data.id,
                        returnTo: `/test-plans/${data.id}/edit`,
                        createdInline: true,
                      },
                    })
                    return
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                    showAlert(msg || 'Failed to start a new test plan')
                    return
                  }
                }
                navigate('/fields/new', {
                  state: {
                    fromPlan: true,
                    ownerTestPlanId: planId,
                    returnTo: `/test-plans/${planId}/edit`,
                    createdInline,
                  },
                })
              }}
              fieldDefaults={
                fieldDefaults as Record<string, string | number | boolean | string[]>
              }
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
                        const setVal = (v: string | number | boolean | string[] | TimerValue) =>
                          setFieldDefaults((prev) => {
                            if (v === '' || v == null || (typeof v === 'number' && Number.isNaN(v))) {
                              const next = { ...prev }
                              delete next[key]
                              return next
                            }
                            if (Array.isArray(v) && v.length === 0) {
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
                              {f.type === 'radio_select' && (
                                <SelectInput
                                  value={val === undefined ? '' : String(val)}
                                  onChange={(v) => setVal(v)}
                                  options={f.config?.options || []}
                                  placeholder="(none)"
                                  className="w-full"
                                />
                              )}
                              {f.type === 'checkbox_select' && (
                                <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-border bg-background p-2">
                                  <p className="text-[11px] text-foreground/50">Leave unchecked for no default</p>
                                  {(f.config?.options ?? []).filter(Boolean).map((opt) => (
                                    <label key={opt} className="flex cursor-pointer items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={Array.isArray(val) && val.includes(opt)}
                                        onChange={() => {
                                          const cur = Array.isArray(val) ? [...val] : []
                                          const i = cur.indexOf(opt)
                                          if (i >= 0) cur.splice(i, 1)
                                          else cur.push(opt)
                                          setVal(cur)
                                        }}
                                        className="h-4 w-4 rounded border-border"
                                      />
                                      <span className="text-sm text-foreground">{opt}</span>
                                    </label>
                                  ))}
                                </div>
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
                              {f.type === 'atlas_location' && (
                                <AtlasLocationInput
                                  value={val === undefined ? '' : String(val)}
                                  onChange={(v) => setVal(v)}
                                  showClear
                                  className="w-full"
                                />
                              )}
                              {!['number', 'text', 'longtext', 'boolean', 'select', 'radio_select', 'checkbox_select', 'status', 'atlas_location'].includes(f.type) && (
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
      <FormulaEditorModal
        open={!!statusConditionalFormulaModal}
        initialValue={
          statusConditionalFormulaModal
            ? String(
                (
                  conditionalStatusRules?.[statusConditionalFormulaModal.fieldId]?.[
                    statusConditionalFormulaModal.optionLabel
                  ] as ConditionalStatusOptionCondition | null | undefined
                )?.formula ?? ''
              )
            : ''
        }
        availableFields={planFields}
        onClose={() => setStatusConditionalFormulaModal(null)}
        onSave={(formula) => {
          if (!statusConditionalFormulaModal) return
          const { fieldId, optionLabel } = statusConditionalFormulaModal
          setConditionalStatusRules((prev) => {
            const p = { ...(prev ?? {}) }
            const inner = { ...(p[fieldId] ?? {}) }
            inner[optionLabel] = { mode: 'formula', formula }
            p[fieldId] = inner
            return p
          })
          setStatusConditionalFormulaModal(null)
        }}
        overlayClassName="z-[80]"
      />
    </div>
  )
}
