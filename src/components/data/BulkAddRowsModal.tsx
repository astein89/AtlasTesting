import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PopupSelect } from '../ui/PopupSelect'
import { renderFormField } from '../fields/FormFieldRenderer'
import type { DataField, TimerValue, TestPlan } from '../../types'
import { getStatusOptions } from '../../types'
import { api } from '../../api/client'
import { computeFormulaValues } from '../../utils/formulaEvaluator'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'
import { getFieldValidationErrors } from '../../utils/fieldValidation'
import { useAuthStore } from '../../store/authStore'

type FieldValue = string | number | boolean | string[] | TimerValue

interface BulkAddRowsModalProps {
  fields: DataField[]
  plan: TestPlan
  onClose: () => void
  onCreated: () => void
}

export function BulkAddRowsModal({ fields, plan, onClose, onCreated }: BulkAddRowsModalProps) {
  const { showAlert } = useAlertConfirm()
  const [targetFieldKey, setTargetFieldKey] = useState<string>(() => plan.keyField || fields[0]?.key || '')
  const [entryValue, setEntryValue] = useState<FieldValue | ''>('')
  const [entries, setEntries] = useState<FieldValue[]>([])
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([])
  const [sharedValues, setSharedValues] = useState<Record<string, FieldValue>>({})
  const [submitting, setSubmitting] = useState(false)
  const [overrideValidation, setOverrideValidation] = useState(false)
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const entryFieldRef = useRef<HTMLDivElement>(null)

  const visibleFields = useMemo(
    () => fields.filter((f) => !(plan.hiddenFieldIds ?? []).includes(f.id)),
    [fields, plan.hiddenFieldIds]
  )

  const mainInputFields = useMemo(
    () =>
      visibleFields.filter((f) =>
        f.type === 'text' ||
        f.type === 'longtext' ||
        f.type === 'number' ||
        f.type === 'select'
      ),
    [visibleFields]
  )

  const targetFieldOptions = useMemo(
    () =>
      mainInputFields.map((f) => ({ value: f.key, label: f.label || f.key })),
    [mainInputFields]
  )

  useEffect(() => {
    if (!targetFieldKey && targetFieldOptions.length > 0) {
      setTargetFieldKey(targetFieldOptions[0].value)
    }
  }, [targetFieldKey, targetFieldOptions])

  useEffect(() => {
    const focusEntry = () => {
      const el = entryFieldRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(
        'input:not([type="hidden"]), textarea, button[type="button"]'
      )
      el?.focus()
    }
    const t = setTimeout(focusEntry, 0)
    return () => clearTimeout(t)
  }, [])

  const targetField =
    mainInputFields.find((f) => f.key === targetFieldKey) ?? mainInputFields[0]

  const optionalFields = useMemo(
    () =>
      visibleFields.filter(
        (f) => f.key !== targetField?.key && f.type !== 'formula'
      ),
    [visibleFields, targetField?.key]
  )

  const addEntry = () => {
    if (!targetField) return
    const v = entryValue
    const isEmpty =
      v === null ||
      v === undefined ||
      v === '' ||
      (typeof v === 'string' && v.trim() === '')

    if (isEmpty) {
      showAlert('Enter a value before adding.')
      return
    }

    if (!overrideValidation) {
      // Run the standard field validation for this single value (min/max length, etc.)
      const dataForValidation: Record<string, FieldValue> = {
        [targetField.key]: v as FieldValue,
      }
      const errors = getFieldValidationErrors([targetField], dataForValidation, {
        // No extra required ids here; this is just per-field validation.
        requiredFieldIds: [],
      })
      if (errors.length > 0) {
        showAlert(errors[0].message)
        return
      }
    }

    setEntries((prev) => [...prev, v as FieldValue])
    // Reset to an empty value for the next entry.
    setEntryValue('')
    // Refocus the enter value field so user can type or scan the next value.
    setTimeout(() => {
      const el = entryFieldRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(
        'input:not([type="hidden"]), textarea, button[type="button"]'
      )
      el?.focus()
    }, 0)
  }

  const toggleSharedField = (fieldId: string) => {
    setSelectedFieldIds((prev) =>
      prev.includes(fieldId) ? prev.filter((id) => id !== fieldId) : [...prev, fieldId]
    )
  }

  const hasEnteredData = useMemo(() => {
    if (entries.length > 0) return true
    const entryFilled =
      entryValue !== '' &&
      entryValue !== null &&
      entryValue !== undefined &&
      (typeof entryValue !== 'string' || entryValue.trim() !== '')
    if (entryFilled) return true
    const hasShared =
      selectedFieldIds.some((id) => {
        const f = visibleFields.find((x) => x.id === id)
        if (!f) return false
        const v = sharedValues[f.key]
        if (v === undefined || v === null) return false
        if (typeof v === 'string') return v.trim() !== ''
        if (typeof v === 'number') return true
        if (typeof v === 'boolean') return true
        if (Array.isArray(v)) return v.length > 0
        return true
      })
    return hasShared
  }, [entries.length, entryValue, selectedFieldIds, sharedValues, visibleFields])

  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const handleCloseRequest = useCallback(() => {
    if (hasEnteredData) {
      setShowCloseConfirm(true)
    } else {
      onClose()
    }
  }, [hasEnteredData, onClose])

  useEffect(() => {
    if (!showCloseConfirm) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCloseConfirm(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showCloseConfirm])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showCloseConfirm) {
        handleCloseRequest()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showCloseConfirm, handleCloseRequest])

  const handleSubmit = async () => {
    if (!plan.id) return
    if (!targetField) {
      showAlert('Select a field to apply the entered values to.')
      return
    }
    if (entries.length === 0) {
      showAlert('Enter at least one value to create rows.')
      return
    }
    setSubmitting(true)
    try {
      const baseShared: Record<string, FieldValue> = {}
      for (const fieldId of selectedFieldIds) {
        const f = visibleFields.find((x) => x.id === fieldId)
        if (f) baseShared[f.key] = sharedValues[f.key]
      }

      const payloads = entries.map((val) => {
        const row: Record<string, FieldValue> = {
          ...baseShared,
          [targetField.key]: val,
        }
        return {
          testPlanId: plan.id,
          data: computeFormulaValues(fields, row),
          status: 'partial',
        }
      })

      await Promise.all(payloads.map((p) => api.post('/records', p)))
      onCreated()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to bulk add rows')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleCloseRequest}
        aria-hidden
      />
      <div
        className="relative z-10 flex max-h-[90dvh] w-full max-w-full flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:max-w-3xl sm:rounded-lg sm:min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4 border-b border-border pb-4">
            <h2 className="text-lg font-semibold text-foreground">Bulk add rows</h2>
            {isAdmin && (
              <label className="flex items-center gap-2 text-xs text-foreground/60">
                <input
                  type="checkbox"
                  checked={overrideValidation}
                  onChange={(e) => setOverrideValidation(e.target.checked)}
                />
                <span>Override validation</span>
              </label>
            )}
          </div>

          <div className="mb-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
              <PopupSelect
                label="Field to apply entered values to"
                value={targetFieldKey}
                onChange={(v) => setTargetFieldKey(v)}
                options={targetFieldOptions}
                className="w-full"
                disabled={entries.length > 0}
              />
              <div>
                <label className="block text-sm font-medium text-foreground">Enter value</label>
                <div
                  className="mt-1 flex items-start gap-2"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addEntry()
                    }
                  }}
                >
                  <div
                    ref={entryFieldRef}
                    className="w-full max-w-xl rounded-lg border border-border bg-background px-2 py-1.5"
                  >
                    {targetField &&
                      renderFormField(
                        targetField,
                        entryValue ?? '',
                        (_key, val) => setEntryValue(val),
                        { compact: true, overrideValidation }
                      )}
                  </div>
                  <button
                    type="button"
                    onClick={addEntry}
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="flex items-end justify-end text-sm text-foreground/70">
                <span>{entries.length} value{entries.length === 1 ? '' : 's'} entered</span>
              </div>
            </div>
            {entries.length > 0 && (
              <div className="mt-2 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border">
                <table className="min-w-full border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
                  <thead className="sticky top-0 z-10 border-b border-border bg-card">
                    <tr>
                      <th className="w-full px-4 py-1.5 text-left text-sm font-medium text-foreground">
                        {targetField?.label || targetField?.key || 'Value'}
                      </th>
                      <th className="w-0 px-3 py-1.5 text-right text-sm font-medium text-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                </table>
                <div className="h-[12.25rem] min-h-[12.25rem] overflow-y-auto">
                  <table className="min-w-full border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
                    <tbody className="divide-y divide-border">
                      {entries.map((v, i) => (
                        <tr
                          key={`${i}-${String(v)}`}
                          className="bg-background transition-colors hover:bg-card"
                        >
                          <td className="min-w-0 px-4 py-1.5 text-foreground">
                            <span className="inline-block max-w-full truncate">{String(v)}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setEntries((prev) => prev.filter((_, idx) => idx !== i))
                              }
                              className="text-sm text-red-500 hover:text-red-400"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Optional fields (same for all new rows)</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground/60">
                  Added fields & values
                </h4>
                {selectedFieldIds.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-foreground/50">
                    Choose fields from the Available list to set a value once and apply it to all new rows.
                  </p>
                ) : (
                  <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
                    {optionalFields
                      .filter((f) => selectedFieldIds.includes(f.id))
                      .map((f) => (
                        <div key={f.id}>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <label className="block text-xs font-medium text-foreground/80">
                              {f.label || f.key}
                            </label>
                            <button
                              type="button"
                              onClick={() => toggleSharedField(f.id)}
                              className="text-[11px] text-foreground/60 hover:text-foreground"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="max-w-xl">
                            {renderFormField(
                              f,
                              sharedValues[f.key] ?? '',
                              (_key, val) =>
                                setSharedValues((prev) => ({
                                  ...prev,
                                  [f.key]: val,
                                })),
                              { compact: true }
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground/60">
                  Available
                </h4>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border bg-card/40 p-2">
                  {optionalFields.filter((f) => !selectedFieldIds.includes(f.id)).length === 0 && (
                    <p className="text-xs text-foreground/50">No additional fields available.</p>
                  )}
                  {optionalFields
                    .filter((f) => !selectedFieldIds.includes(f.id))
                    .map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-background/40"
                      >
                        <span className="min-w-0 flex-1 truncate text-foreground/80">
                          {f.label || f.key}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleSharedField(f.id)}
                          className="rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground hover:bg-background/80"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
          <button
            type="button"
            onClick={handleCloseRequest}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || entries.length === 0 || !targetField}
            className="min-h-[44px] min-w-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
          >
            {submitting ? 'Saving…' : 'Create rows'}
          </button>
        </div>
      </div>

      {showCloseConfirm && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowCloseConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-add-close-confirm-title"
        >
          <div
            className="flex max-w-sm flex-col rounded-xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="bulk-add-close-confirm-title" className="border-b border-border px-4 py-3 text-lg font-semibold text-foreground">
              Unsaved data
            </h2>
            <p className="px-4 py-3 text-sm text-foreground">
              You have entered data. Create rows now or discard?
            </p>
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setShowCloseConfirm(false)
                  handleSubmit()
                }}
                disabled={submitting || entries.length === 0 || !targetField}
                className="min-h-[44px] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Create rows
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCloseConfirm(false)
                  onClose()
                }}
                className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

