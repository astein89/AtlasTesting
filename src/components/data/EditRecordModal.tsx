import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { renderFormField } from '../fields/FormFieldRenderer'
import { SelectInput } from '../fields/SelectInput'
import { buildFormRowsFromOrder, isSeparatorId, isSeparatorLineId, normalizeFormLayoutOrder, parseFieldEntry, SPAN_TO_COLS } from '../../utils/formLayout'
import { getFieldValidationErrors } from '../../utils/fieldValidation'
import { formatFieldValue } from '../../utils/formatFieldValue'
import { getContrastTextColor } from '../../utils/colorContrast'
import type { DataField, TimerValue } from '../../types'
import { getStatusOptions } from '../../types'
import { formatDateTime } from '../../lib/dateTimeConfig'

interface Record {
  id: string
  recordedAt: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
}

interface HistoryChange {
  field: string
  oldVal: unknown
  newVal: unknown
}

interface HistoryEntry {
  at: string
  by: string
  byId: string
  action: string
  changes: HistoryChange[]
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
  plan?: { keyField?: string; hiddenFieldIds?: string[]; requiredFieldIds?: string[] }
  /** When true, show History button in footer (admin-only) */
  isAdmin?: boolean
  /** When true, show record as read-only (e.g. for viewer role) */
  readOnly?: boolean
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
  isAdmin = false,
  readOnly = false,
}: EditRecordModalProps) {
  const [showSavePrompt, setShowSavePrompt] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Array<{ fieldKey: string; message: string }>>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [fullScreenImagePath, setFullScreenImagePath] = useState<string | null>(null)
  const [overrideValidation, setOverrideValidation] = useState(false)

  const imageUrl = useCallback((p: string) => {
    if (p.startsWith('http')) return p
    const path = p.startsWith('/') ? p : '/' + p
    return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
  }, [])

  const handleDataChange = useCallback(
    (key: string, value: string | number | boolean | string[] | TimerValue) => {
      setValidationErrors((prev) => prev.filter((e) => e.fieldKey !== key))
      onDataChange(key, value)
    },
    [onDataChange]
  )

  const handleClose = useCallback(() => {
    if (readOnly) {
      onCancel()
      return
    }
    if (dataChanged(record.data, data)) {
      setShowSavePrompt(true)
    } else {
      onCancel()
    }
  }, [readOnly, record.data, data, onCancel])

  const handleSaveClick = useCallback(() => {
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

  const handleSaveAndClose = useCallback(() => {
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
    setShowSavePrompt(false)
    onSave()
  }, [fields, data, plan?.requiredFieldIds, onSave, overrideValidation])

  const handleDiscardAndClose = useCallback(() => {
    setShowSavePrompt(false)
    onCancel()
  }, [onCancel])

  const statusField = fields.find((f) => f.type === 'status')
  const hiddenSet = new Set(plan?.hiddenFieldIds ?? [])
  const formOrderWithoutStatus = (statusField
    ? normalizeFormLayoutOrder(formLayoutOrder, fields).filter((entry) => {
        if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
        return parseFieldEntry(entry).fieldId !== statusField.id
      })
    : normalizeFormLayoutOrder(formLayoutOrder, fields)
  ).filter((entry) => {
    if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
    return !hiddenSet.has(parseFieldEntry(entry).fieldId)
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (fullScreenImagePath) setFullScreenImagePath(null)
        else if (showHistory) setShowHistory(false)
        else if (!readOnly && showSavePrompt) setShowSavePrompt(false)
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
  }, [handleClose, readOnly, showSavePrompt, showHistory, fullScreenImagePath])

  useEffect(() => {
    if (!showHistory || !record.id) return
    setHistoryLoading(true)
    setHistoryError(null)
    setHistoryEntries(null)
    api
      .get<HistoryEntry[]>(`/records/${record.id}/history`)
      .then((res) => setHistoryEntries(res.data))
      .catch((err) => {
        const msg = err.response?.status === 403 ? 'Admin required' : err.response?.data?.error ?? 'Failed to load history'
        setHistoryError(msg)
      })
      .finally(() => setHistoryLoading(false))
  }, [showHistory, record.id])

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden
      />
      <div
        className="relative z-10 flex max-h-[90dvh] w-full max-w-full flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:max-w-2xl sm:rounded-lg sm:min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">
              {readOnly ? 'View row' : 'Edit row'} — {formatDateTime(record.recordedAt)}
            </h2>
            {isAdmin && !readOnly && (
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
            {statusField && !plan?.hiddenFieldIds?.includes(statusField.id) ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="shrink-0 text-sm font-medium text-foreground/50">Status</span>
              {readOnly ? (
                (() => {
                  const statusColor = statusField.config?.statusColors?.[String(data[statusField.key] ?? '')]
                  return (
                    <span
                      className="rounded border border-border bg-background px-3 py-1.5 text-sm"
                      style={
                        statusColor
                          ? { backgroundColor: statusColor, color: getContrastTextColor(statusColor) }
                          : undefined
                      }
                    >
                      {String(data[statusField.key] ?? '') || '—'}
                    </span>
                  )
                })()
              ) : (
                <SelectInput
                  value={String(data[statusField.key] ?? '')}
                  onChange={(v) => onDataChange(statusField.key, v)}
                  options={getStatusOptions(statusField)}
                  className="min-w-[140px]"
                  valueColor={statusField.config?.statusColors?.[String(data[statusField.key] ?? '')]}
                  optionColors={statusField.config?.statusColors}
                />
              )}
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <div className="w-full min-w-0 space-y-4">
            {readOnly
              ? buildFormRowsFromOrder(fields, formOrderWithoutStatus).map((row, ri) =>
                  Array.isArray(row) ? (
                    <div
                      key={ri}
                      className="grid w-full gap-4"
                      style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}
                    >
                      {row.map(({ field, span }) => {
                        const rawVal = data[field.key]
                        const imagePaths = Array.isArray(rawVal) ? rawVal : rawVal ? [rawVal] : []
                        const isImage = field.type === 'image'
                        return (
                          <div
                            key={field.id}
                            className="min-w-0 w-full"
                            style={{ gridColumn: `span ${SPAN_TO_COLS[span]}` }}
                          >
                            <div className="mb-1 text-sm font-medium text-foreground/70">{field.label}</div>
                            <div className="min-w-0 w-full text-sm text-foreground">
                              {field.type === 'longtext' ? (
                                <p className="whitespace-pre-wrap">{formatFieldValue(field, data[field.key])}</p>
                              ) : isImage && imagePaths.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {imagePaths.map((p, i) => (
                                    <div key={`${p}-${i}`} className="relative">
                                      <button
                                        type="button"
                                        onClick={() => setFullScreenImagePath(p)}
                                        className="block text-left"
                                      >
                                        <img
                                          src={imageUrl(p)}
                                          alt=""
                                          className="h-20 w-20 cursor-pointer rounded-lg border border-border object-cover bg-background hover:opacity-90"
                                        />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                formatFieldValue(field, data[field.key])
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div key={ri} className="my-4 border-t-2 border-border" />
                  )
                )
              : buildFormRowsFromOrder(fields, formOrderWithoutStatus).map((row, ri) =>
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
                          {(plan?.requiredFieldIds?.includes(field.id) || field.config?.required) && (
                            <span className="text-red-500" aria-label="required"> *</span>
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
        <div className="flex shrink-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
          <div className="flex shrink-0 gap-2">
            {!readOnly && isAdmin && (
              <button
                type="button"
                onClick={() => setShowHistory(true)}
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
              >
                History
              </button>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            {readOnly ? (
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={submitting}
                  className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-red-500/50 px-4 py-2 text-red-500 hover:bg-red-500/10 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveClick}
                  disabled={submitting}
                  className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
                >
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    {fullScreenImagePath && (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
        onClick={() => setFullScreenImagePath(null)}
      >
        <img
          src={imageUrl(fullScreenImagePath)}
          alt=""
          className="max-h-full max-w-full cursor-pointer object-contain"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setFullScreenImagePath(null)
          }}
          className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
        >
          ✕
        </button>
      </div>
    )}
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
    {showHistory && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        onClick={() => setShowHistory(false)}
      >
        <div
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-lg font-semibold text-foreground">Record history</h3>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {historyLoading && <p className="text-muted-foreground">Loading...</p>}
            {historyError && <p className="text-red-500">{historyError}</p>}
            {!historyLoading && !historyError && historyEntries && (
              <ul className="space-y-4">
                {historyEntries.length === 0 && <li className="text-muted-foreground">No history entries.</li>}
                {historyEntries.map((entry, i) => (
                  <li key={i} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="font-medium text-foreground">
                        {formatDateTime(entry.at)}
                      </span>
                      <span className="text-muted-foreground">{entry.by}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium capitalize text-foreground">
                        {entry.action}
                      </span>
                    </div>
                    {entry.changes.length > 0 && (
                      <ul className="mt-2 space-y-1 pl-2 text-sm text-muted-foreground">
                        {entry.changes.map((c, j) => (
                          <li key={j}>
                            {c.field}: {c.oldVal === undefined || c.oldVal === null ? '—' : String(c.oldVal)}{' '}
                            → {c.newVal === undefined || c.newVal === null ? '—' : String(c.newVal)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  )
}
