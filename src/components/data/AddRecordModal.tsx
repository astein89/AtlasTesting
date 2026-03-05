import { useCallback, useEffect, useState } from 'react'
import { renderFormField } from '../fields/FormFieldRenderer'
import { buildFormRowsFromOrder, normalizeFormLayoutOrder } from '../../utils/formLayout'
import type { DataField } from '../../types'

interface AddRecordModalProps {
  fields: DataField[]
  data: Record<string, string | number | boolean>
  onDataChange: (key: string, value: string | number | boolean) => void
  onSave: () => void
  onCancel: () => void
  submitting: boolean
  formLayoutOrder?: string[]
}

function hasData(data: Record<string, string | number | boolean>): boolean {
  return Object.values(data).some((v) => {
    if (typeof v === 'number') return v !== 0
    if (typeof v === 'boolean') return v
    if (Array.isArray(v)) return v.length > 0
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
}: AddRecordModalProps) {
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false)

  const handleClose = useCallback(() => {
    if (hasData(data)) {
      setShowDiscardPrompt(true)
    } else {
      onCancel()
    }
  }, [data, onCancel])

  const handleDiscardAndClose = useCallback(() => {
    setShowDiscardPrompt(false)
    onCancel()
  }, [onCancel])

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
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        onClick={handleClose}
      >
        <div
          className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:rounded-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Add row</h2>
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
          <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
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
              disabled={submitting || !hasData(data)}
              className="min-h-[44px] min-w-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      {showDiscardPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowDiscardPrompt(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-foreground">Discard unsaved data?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardPrompt(false)}
                className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
              >
                No
              </button>
              <button
                type="button"
                onClick={handleDiscardAndClose}
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
