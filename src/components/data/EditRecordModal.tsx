import { useCallback, useEffect, useState } from 'react'
import { renderFormField } from '../fields/FormFieldRenderer'
import { buildFormRowsFromOrder, normalizeFormLayoutOrder } from '../../utils/formLayout'
import type { DataField } from '../../types'

interface Record {
  id: string
  recordedAt: string
  status: string
  data: Record<string, string | number | boolean>
}

interface EditRecordModalProps {
  record: Record
  fields: DataField[]
  data: Record<string, string | number | boolean>
  onDataChange: (key: string, value: string | number | boolean) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  submitting: boolean
  formLayoutOrder?: string[]
}

function dataChanged(
  original: Record<string, string | number | boolean>,
  current: Record<string, string | number | boolean>
): boolean {
  const keys = new Set([...Object.keys(original), ...Object.keys(current)])
  for (const k of keys) {
    const a = original[k]
    const b = current[k]
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return true
      if (a.some((v, i) => v !== b[i])) return true
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
}: EditRecordModalProps) {
  const [showSavePrompt, setShowSavePrompt] = useState(false)

  const handleClose = useCallback(() => {
    if (dataChanged(record.data, data)) {
      setShowSavePrompt(true)
    } else {
      onCancel()
    }
  }, [record.data, data, onCancel])

  const handleSaveAndClose = useCallback(() => {
    setShowSavePrompt(false)
    onSave()
  }, [onSave])

  const handleDiscardAndClose = useCallback(() => {
    setShowSavePrompt(false)
    onCancel()
  }, [onCancel])

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
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Edit row — {new Date(record.recordedAt).toLocaleString()}
          </h2>
            <div className="space-y-4">
              {buildFormRowsFromOrder(fields, normalizeFormLayoutOrder(formLayoutOrder, fields)).map((row, ri) =>
                Array.isArray(row) ? (
                  <div key={ri} className="grid grid-cols-6 gap-4">
                    {row.map(({ field, span }) => (
                      <div
                        key={field.id}
                        className={`min-w-0 ${span === 1 ? 'col-span-2' : span === 4 ? 'col-span-3' : span === 2 ? 'col-span-4' : 'col-span-6'}`}
                      >
                        <label className="mb-1 block text-sm font-medium text-foreground">
                          {field.label}
                        </label>
                        {renderFormField(field, data[field.key], onDataChange)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div key={ri} className="my-4 border-t-2 border-border" />
                )
              )}
            </div>
        </div>
        <div className="flex shrink-0 justify-between gap-2 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
          <button
            type="button"
            onClick={onDelete}
            disabled={submitting}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-red-500/50 px-4 py-2 text-red-500 hover:bg-red-500/10 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
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
