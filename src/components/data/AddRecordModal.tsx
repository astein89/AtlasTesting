import { useCallback, useEffect, useState } from 'react'
import { renderFormField } from '../fields/FormFieldRenderer'
import { SelectInput } from '../fields/SelectInput'
import { buildFormRowsFromOrder, isSeparatorId, isSeparatorLineId, normalizeFormLayoutOrder, parseFieldEntry, SPAN_TO_COLS } from '../../utils/formLayout'
import { getFieldValidationErrors } from '../../utils/fieldValidation'
import { useAuthStore } from '../../store/authStore'
import { formatDateTime } from '../../lib/dateTimeConfig'
import type { DataField, TimerValue } from '../../types'
import { getStatusOptions } from '../../types'
import { resolveHeaderStatusField } from '../../utils/headerStatusField'

interface AddRecordModalProps {
  fields: DataField[]
  data: Record<string, string | number | boolean | string[] | TimerValue>
  onDataChange: (key: string, value: string | number | boolean | string[] | TimerValue) => void
  onSave: () => void
  onCancel: () => void
  submitting: boolean
  formLayoutOrder?: string[]
  /** Plan key field for naming uploaded images (key_field + image_tag + timestamp) */
  plan?: {
    keyField?: string
    hiddenFieldIds?: string[]
    requiredFieldIds?: string[]
    mainStatusFieldId?: string | null
  }
  /**
   * When set, exit confirmation (backdrop, Cancel, Escape) uses this instead of `hasData(data)`.
   * Prefer comparing the form to its initial baseline so default-filled fields do not count as “edits”.
   */
  unsavedChanges?: boolean
}

function hasData(data: Record<string, string | number | boolean | string[] | TimerValue>): boolean {
  return Object.values(data).some((v) => {
    if (typeof v === 'number') return v !== 0
    if (typeof v === 'boolean') return v
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'object' && v !== null && 'totalElapsedMs' in v) {
      const t = v as TimerValue
      return t.totalElapsedMs > 0 || !!t.startedAt
    }
    return String(v ?? '').trim() !== ''
  })
}

export function AddRecordModal({
  fields,
  data,
  onDataChange,
  onSave,
  onCancel,
  submitting,
  formLayoutOrder = [],
  plan,
  unsavedChanges,
}: AddRecordModalProps) {
  /** Stable “record” time for header (matches Edit row — … layout). */
  const [headerRecordedAt] = useState(() => new Date().toISOString())
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Array<{ fieldKey: string; message: string }>>([])
  const [overrideValidation, setOverrideValidation] = useState(false)
  const isAdmin = useAuthStore((s) => s.isAdmin())

  const handleDataChange = useCallback(
    (key: string, value: string | number | boolean | string[] | TimerValue) => {
      setValidationErrors((prev) => prev.filter((e) => e.fieldKey !== key))
      onDataChange(key, value)
    },
    [onDataChange]
  )

  const handleClose = useCallback(() => {
    const dirty = unsavedChanges !== undefined ? unsavedChanges : hasData(data)
    if (dirty) {
      setShowDiscardPrompt(true)
    } else {
      onCancel()
    }
  }, [data, onCancel, unsavedChanges])

  const handleDiscardAndClose = useCallback(() => {
    setShowDiscardPrompt(false)
    onCancel()
  }, [onCancel])

  const handleSave = useCallback(() => {
    if (!overrideValidation) {
      const errors = getFieldValidationErrors(fields, data, {
        requiredFieldIds: plan?.requiredFieldIds,
      })
      if (errors.length > 0) {
        setValidationErrors(errors)
        return
      }
    }
    setValidationErrors([])
    onSave()
  }, [fields, data, plan?.requiredFieldIds, onSave, overrideValidation])

  const headerStatusField = resolveHeaderStatusField(fields, plan?.mainStatusFieldId)
  const hiddenSet = new Set(plan?.hiddenFieldIds ?? [])
  const formOrderWithoutStatus = (headerStatusField
    ? normalizeFormLayoutOrder(formLayoutOrder, fields).filter((entry) => {
        if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
        return parseFieldEntry(entry).fieldId !== headerStatusField.id
      })
    : normalizeFormLayoutOrder(formLayoutOrder, fields)
  ).filter((entry) => {
    if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
    return !hiddenSet.has(parseFieldEntry(entry).fieldId)
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDiscardPrompt) setShowDiscardPrompt(false)
        else handleClose()
      }
    }
    window.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [handleClose, showDiscardPrompt])

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-black/50" aria-hidden />
        <div
          className="relative z-10 flex h-[100dvh] w-full max-w-full flex-col overflow-hidden rounded-none border-0 border-border bg-card shadow-lg sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-lg sm:border sm:min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
              <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">
                Add row — {formatDateTime(headerRecordedAt)}
              </h2>
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
            {headerStatusField && !plan?.hiddenFieldIds?.includes(headerStatusField.id) ? (
              <div className="flex min-w-0 max-w-[min(22rem,50vw)] items-center gap-2 sm:max-w-md">
                <span
                  className="min-w-0 shrink truncate text-sm font-medium text-foreground/50"
                  title={headerStatusField.label}
                >
                  {headerStatusField.label}
                </span>
                <SelectInput
                  value={String(data[headerStatusField.key] ?? '')}
                  onChange={(v) => onDataChange(headerStatusField.key, v)}
                  options={getStatusOptions(headerStatusField)}
                  placeholder="None"
                  className="min-w-0 max-w-[min(12rem,42vw)] flex-1 sm:max-w-[14rem]"
                  valueColor={headerStatusField.config?.statusColors?.[String(data[headerStatusField.key] ?? '')]}
                  optionColors={headerStatusField.config?.statusColors}
                />
              </div>
            ) : null}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 sm:p-6">
            <div className="w-full min-w-0 space-y-4">
              {buildFormRowsFromOrder(fields, formOrderWithoutStatus).map((row, ri) =>
                Array.isArray(row) ? (
                  <div
                    key={ri}
                    className="grid w-full gap-4"
                    style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}
                  >
                    {row.map(({ field, span }) => {
                      const fieldError = validationErrors.find((e) => e.fieldKey === field.key)
                      const keyFieldVal = plan?.keyField ? String(data[plan.keyField] ?? '').trim() : ''
                      const uploadNamePrefix =
                        field.type === 'image'
                          ? `${keyFieldVal || 'new'}_${field.config?.imageTag ?? 'image'}`
                          : undefined
                      return (
                        <div
                          key={field.id}
                          className="min-w-0 w-full"
                          style={{ gridColumn: `span ${SPAN_TO_COLS[span]}` }}
                        >
                          <label
                            className={`mb-1 flex min-w-0 items-baseline gap-0.5 text-sm font-medium ${fieldError ? 'text-red-500' : 'text-foreground'}`}
                            title={field.label}
                          >
                            <span className="min-w-0 truncate">{field.label}</span>
                            {(plan?.requiredFieldIds?.includes(field.id) || field.config?.required) && (
                              <span className="shrink-0 text-red-500" aria-label="required"> *</span>
                            )}
                          </label>
                          <div
                            className={`min-w-0 w-full rounded border ${fieldError ? 'border-red-500 ring-1 ring-red-500/30' : 'border-transparent'}`}
                          >
                            {renderFormField(field, data[field.key], handleDataChange, {
                              uploadNamePrefix,
                              overrideValidation,
                            })}
                          </div>
                          {fieldError && (
                            <p className="mt-1 text-xs text-red-500">{fieldError.message}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div key={ri} className="my-4 border-t-2 border-border" />
                )
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 overflow-x-hidden border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
            <div className="flex shrink-0 gap-2" />
            <div className="flex shrink-0 justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={submitting || !hasData(data)}
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
              >
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showDiscardPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-foreground">Save changes before closing?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardPrompt(false)}
                className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDiscardAndClose}
                className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
              >
                No
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="min-h-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
