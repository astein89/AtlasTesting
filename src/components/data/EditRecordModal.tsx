import { useCallback, useEffect, useState } from 'react'
import { renderFormField } from '../fields/FormFieldRenderer'
import { SelectInput } from '../fields/SelectInput'
import { buildFormRowsFromOrder, isSeparatorId, isSeparatorLineId, normalizeFormLayoutOrder, parseFieldEntry, SPAN_TO_COLS } from '../../utils/formLayout'
import { getFieldValidationErrors } from '../../utils/fieldValidation'
import type { DataField, TimerValue } from '../../types'
import { getStatusOptions } from '../../types'

interface Record {
  id: string
  recordedAt: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
}

interface EditRecordModalProps {
  record: Record
  fields: DataField[]
  data: Record<string, string | number | boolean | string[] | TimerValue>
  onDataChange: (key: string, value: string | number | boolean | string[] | TimerValue) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  submitting: boolean
  formLayoutOrder?: string[]
  /** Plan key field for naming uploaded images (key_field + image_tag + timestamp) */
  plan?: { keyField?: string }
}

function dataChanged(
  original: Record<string, string | number | boolean | string[] | TimerValue>,
  current: Record<string, string | number | boolean | string[] | TimerValue>
): boolean {
  const keys = new Set([...Object.keys(original), ...Object.keys(current)])
  for (const k of keys) {
    const a = original[k]
    const b = current[k]
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return true
      if (a.some((v, i) => v !== b[i])) return true
    } else if (typeof a === 'object' && a !== null && 'totalElapsedMs' in a && typeof b === 'object' && b !== null && 'totalElapsedMs' in b) {
      const ta = a as TimerValue
      const tb = b as TimerValue
      if (ta.totalElapsedMs !== tb.totalElapsedMs || ta.startedAt !== tb.startedAt) return true
    } else if (a !== b) {
      return true
    }
  }
  return false
}

export function EditRecordModal({
  record,
  fields,
  data,
  onDataChange,
  onSave,
  onCancel,
  onDelete,
  submitting,
  formLayoutOrder = [],
  plan,
}: EditRecordModalProps) {
  const [showSavePrompt, setShowSavePrompt] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Array<{ fieldKey: string; message: string }>>([])

  const handleDataChange = useCallback(
    (key: string, value: string | number | boolean | string[] | TimerValue) => {
      setValidationErrors((prev) => prev.filter((e) => e.fieldKey !== key))
      onDataChange(key, value)
    },
    [onDataChange]
  )

  const handleClose = useCallback(() => {
    if (dataChanged(record.data, data)) {
      setShowSavePrompt(true)
    } else {
      onCancel()
    }
  }, [record.data, data, onCancel])

  const handleSaveClick = useCallback(() => {
    const errors = getFieldValidationErrors(fields, data)
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }
    setValidationErrors([])
    onSave()
  }, [fields, data, onSave])

  const handleSaveAndClose = useCallback(() => {
    const errors = getFieldValidationErrors(fields, data)
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }
    setValidationErrors([])
    setShowSavePrompt(false)
    onSave()
  }, [fields, data, onSave])

  const handleDiscardAndClose = useCallback(() => {
    setShowSavePrompt(false)
    onCancel()
  }, [onCancel])

  const statusField = fields.find((f) => f.type === 'status')
  const formOrderWithoutStatus = statusField
    ? normalizeFormLayoutOrder(formLayoutOrder, fields).filter((entry) => {
        if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
        return parseFieldEntry(entry).fieldId !== statusField.id
      })
    : normalizeFormLayoutOrder(formLayoutOrder, fields)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSavePrompt) setShowSavePrompt(false)
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
  }, [handleClose, showSavePrompt])

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-full flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:max-w-2xl sm:rounded-lg sm:min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Edit row — {new Date(record.recordedAt).toLocaleString()}
          </h2>
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
                        ? `${keyFieldVal || 'record'}_${field.config?.imageTag ?? 'image'}`
                        : undefined
                    return (
                      <div
                        key={field.id}
                        className="min-w-0 w-full"
                        style={{ gridColumn: `span ${SPAN_TO_COLS[span]}` }}
                      >
                        <label
                          className={`mb-1 block text-sm font-medium ${fieldError ? 'text-red-500' : 'text-foreground'}`}
                        >
                          {field.label}
                        </label>
                        <div
                          className={`min-w-0 w-full rounded border ${fieldError ? 'border-red-500 ring-1 ring-red-500/30' : 'border-transparent'}`}
                        >
                          {renderFormField(field, data[field.key], handleDataChange, { uploadNamePrefix })}
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
          {statusField ? (
            <div className="flex w-full min-w-0 basis-full items-center gap-2 sm:basis-0 sm:w-auto">
              <span className="shrink-0 text-sm font-medium text-foreground/50">Status</span>
              <SelectInput
                value={String(data[statusField.key] ?? '')}
                onChange={(v) => onDataChange(statusField.key, v)}
                options={getStatusOptions(statusField)}
                className="min-w-0 flex-1 shrink-0 sm:min-w-[140px] sm:flex-none"
                valueColor={statusField.config?.statusColors?.[String(data[statusField.key] ?? '')]}
                optionColors={statusField.config?.statusColors}
              />
            </div>
          ) : null}
          <div className="flex w-full shrink-0 justify-end gap-2 sm:ml-auto sm:w-auto">
          <button
            type="button"
            onClick={onDelete}
            disabled={submitting}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-red-500/50 px-4 py-2 text-red-500 hover:bg-red-500/10 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
          >
            Delete
          </button>
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={submitting}
              className="min-h-[44px] min-w-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
    {showSavePrompt && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        onClick={() => setShowSavePrompt(false)}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-4 text-foreground">Save changes before closing?</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleDiscardAndClose}
              className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
            >
              No
            </button>
            <button
              type="button"
              onClick={handleSaveAndClose}
              disabled={submitting}
              className="min-h-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
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
