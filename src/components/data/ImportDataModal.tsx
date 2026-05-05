import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PopupSelect } from '../ui/PopupSelect'
import type { DataField, TestPlan } from '../../types'
import { api } from '../../api/client'
import { finalizeRecordDataAfterImportOrBulk } from '../../utils/planConditionalStatus'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'
import { DATETIME_PLAN_DEFAULT_ROW_CREATED, getDefaultValueForField } from '../../utils/fieldDefaults'
import { parseImportFile, type ParsedImportFile } from '../../utils/parseImportFile'
import { coerceCell, coerceRecordedAt } from '../../utils/importCoercion'
import {
  autoMapImportFieldsToColumns,
  autoMapRecordedAtColumn,
} from '../../utils/importColumnAutoMap'

const DONT_MAP = ''

function importRowErrorMessage(e: unknown): string {
  const r = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (typeof r === 'string' && r.trim()) return r.trim()
  if (e instanceof Error && e.message) return e.message
  return 'Request failed'
}

const IMPORTABLE_FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'boolean',
  'datetime',
  'select',
  'radio_select',
  'checkbox_select',
  'status',
  'fraction',
  'weight',
  'atlas_location',
] as const

interface ImportDataModalProps {
  planId: string
  plan: TestPlan
  testId: string
  fields: DataField[]
  onClose: () => void
  onImported: () => void
}

export function ImportDataModal({
  planId,
  plan,
  testId,
  fields,
  onClose,
  onImported,
}: ImportDataModalProps) {
  const { showAlert } = useAlertConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedImportFile | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fieldToColumn, setFieldToColumn] = useState<Record<string, string>>({})
  const [recordedAtColumn, setRecordedAtColumn] = useState<string>(DONT_MAP)
  const [submitting, setSubmitting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [importFailures, setImportFailures] = useState<Array<{ rowNumber: number; reason: string }> | null>(null)

  const visibleFields = useMemo(
    () =>
      fields.filter(
        (f) =>
          !(plan.hiddenFieldIds ?? []).includes(f.id) &&
          f.type !== 'formula' &&
          IMPORTABLE_FIELD_TYPES.includes(f.type as (typeof IMPORTABLE_FIELD_TYPES)[number])
      ),
    [fields, plan.hiddenFieldIds]
  )

  const columnOptions = useMemo(() => {
    const headers = parsed?.headers ?? []
    return headers.map((h) => ({ value: h, label: h }))
  }, [parsed?.headers])

  const recordedAtOptions = useMemo(() => {
    const headers = parsed?.headers ?? []
    return headers.map((h) => ({ value: h, label: h }))
  }, [parsed?.headers])

  const visibleFieldKeysSig = useMemo(() => visibleFields.map((f) => f.key).join('\0'), [visibleFields])

  /** Run auto-map once per (file headers + importable field set); reset when choosing a new file. */
  const autoMappedKeyRef = useRef<string>('')

  const handleDismiss = useCallback(() => {
    setImportFailures(null)
    onClose()
  }, [onClose])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setParseError(null)
    setParsed(null)
    setFieldToColumn({})
    setRecordedAtColumn(DONT_MAP)
    setImportFailures(null)
    autoMappedKeyRef.current = ''
    parseImportFile(f)
      .then(setParsed)
      .catch((err) => setParseError(err?.message || 'Failed to parse file'))
  }, [])

  useEffect(() => {
    if (!parsed?.headers.length) return
    const autoKey = `${parsed.headers.join('\0')}||${visibleFieldKeysSig}`
    if (autoMappedKeyRef.current === autoKey) return
    autoMappedKeyRef.current = autoKey

    const mapping = autoMapImportFieldsToColumns(parsed.headers, visibleFields)
    setFieldToColumn(mapping)
    const used = new Set(Object.values(mapping))
    const rec = autoMapRecordedAtColumn(parsed.headers, used)
    setRecordedAtColumn(rec || DONT_MAP)
  }, [parsed, visibleFields, visibleFieldKeysSig])

  const hasAnyMapping = useMemo(() => {
    const hasField = visibleFields.some((f) => fieldToColumn[f.key])
    const hasRecordedAt = !!recordedAtColumn
    return hasField || hasRecordedAt
  }, [visibleFields, fieldToColumn, recordedAtColumn])

  const handleImport = useCallback(async () => {
    if (!parsed || parsed.rows.length === 0) {
      showAlert('No data rows to import.')
      return
    }
    if (!hasAnyMapping) {
      showAlert('Map at least one column to a field or Recorded at.')
      return
    }
    setSubmitting(true)
    setImportFailures(null)
    setImportProgress({ done: 0, total: parsed.rows.length })
    const failures: Array<{ rowNumber: number; reason: string }> = []
    let imported = 0
    try {
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i]
        const data: Record<string, string | number | boolean | string[]> = {}
        for (const field of visibleFields) {
          const col = fieldToColumn[field.key]
          if (!col) continue
          const raw = row[col] ?? ''
          const coerced = coerceCell(raw, field)
          if (coerced !== undefined) {
            data[field.key] = coerced
          } else if (plan.fieldDefaults?.[field.key] !== undefined) {
            const rawDef = plan.fieldDefaults[field.key]
            if (field.type === 'datetime' && rawDef === DATETIME_PLAN_DEFAULT_ROW_CREATED) {
              data[field.key] = new Date().toISOString()
            } else {
              data[field.key] = rawDef as string | number | boolean | string[]
            }
          } else {
            const def = getDefaultValueForField(field, plan.fieldDefaults)
            if (def !== undefined && def !== null && def !== '') {
              data[field.key] = def as string | number | boolean | string[]
            }
          }
        }
        for (const field of fields) {
          if (data[field.key] === undefined) {
            const def = getDefaultValueForField(field, plan.fieldDefaults)
            if (def !== undefined && def !== null && def !== '') {
              data[field.key] = def as string | number | boolean | string[]
            }
          }
        }
        const finalized = finalizeRecordDataAfterImportOrBulk(fields, plan, data)
        const recordedAt = recordedAtColumn ? coerceRecordedAt(row[recordedAtColumn] ?? '') : undefined
        try {
          await api.post('/records', {
            testPlanId: planId,
            testId,
            data: finalized,
            status: 'partial',
            ...(recordedAt && { recordedAt }),
          })
          imported++
        } catch (e: unknown) {
          failures.push({ rowNumber: i + 1, reason: importRowErrorMessage(e) })
        }
        setImportProgress({ done: i + 1, total: parsed.rows.length })
      }

      if (imported > 0) {
        onImported()
      }

      if (failures.length === 0) {
        onClose()
      } else {
        setImportFailures(failures)
      }
    } catch (e: unknown) {
      showAlert(importRowErrorMessage(e) || 'Import failed')
    } finally {
      setSubmitting(false)
      setImportProgress(null)
    }
  }, [
    parsed,
    hasAnyMapping,
    plan,
    planId,
    testId,
    fields,
    visibleFields,
    fieldToColumn,
    recordedAtColumn,
    onImported,
    onClose,
    showAlert,
  ])

  const previewRows = useMemo(() => (parsed?.rows ?? []).slice(0, 5), [parsed?.rows])

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold text-foreground">Import data from file</h2>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded p-1 text-foreground/70 hover:bg-background hover:text-foreground"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Step 1 – File */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-foreground">File (CSV)</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1 file:text-primary-foreground"
            />
            {parseError && (
              <p className="mt-2 text-sm text-red-500">{parseError}</p>
            )}
            {parsed && (
              <p className="mt-2 text-sm text-foreground/80">
                Detected {parsed.headers.length} column{parsed.headers.length !== 1 ? 's' : ''}, {parsed.rows.length} data
                row{parsed.rows.length !== 1 ? 's' : ''}.
              </p>
            )}
            {parsed && previewRows.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded border border-border">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {parsed.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        {parsed!.headers.map((h) => (
                          <td key={h} className="max-w-[120px] truncate px-2 py-1 text-foreground">
                            {row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Step 2 – Map columns */}
          {parsed && parsed.rows.length > 0 && (
            <>
              <div className="mb-4 border-b border-border pb-4">
                <div className="grid grid-cols-[minmax(120px,280px)_240px] items-center gap-x-4 gap-y-2">
                  <label className="text-sm font-medium text-foreground">Recorded at (optional)</label>
                  <PopupSelect
                    value={recordedAtColumn}
                    onChange={setRecordedAtColumn}
                    options={recordedAtOptions}
                    emptyOption="— Don't use —"
                    className="w-[240px] shrink-0"
                  />
                </div>
              </div>
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-medium text-foreground">Map plan fields to file columns</h3>
                <p className="mb-2 text-xs text-foreground/70">
                  Columns are auto-matched when headers match a field&apos;s key or label (including files exported from
                  this app). Change any mapping below if needed.
                </p>
                <div className="grid grid-cols-[minmax(120px,280px)_240px] items-center gap-x-4 gap-y-2">
                  {visibleFields.map((field) => (
                    <div key={field.id} className="contents">
                      <span className="break-words text-sm text-foreground" title={field.label || field.key}>
                        {field.label || field.key}
                      </span>
                      <PopupSelect
                        value={fieldToColumn[field.key] ?? DONT_MAP}
                        onChange={(v) => setFieldToColumn((prev) => ({ ...prev, [field.key]: v }))}
                        options={columnOptions}
                        emptyOption="— Don't map —"
                        className="w-[240px] shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Step 3 – Import */}
          {importProgress && (
            <p className="mb-4 text-sm text-foreground/80">
              Processed {importProgress.done} / {importProgress.total} rows…
            </p>
          )}

          {importFailures && importFailures.length > 0 && parsed && (
            <div
              className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/[0.07] p-4 dark:bg-amber-500/10"
              role="region"
              aria-label="Import failures"
            >
              <p className="mb-3 text-sm text-foreground">
                Imported{' '}
                <strong className="font-semibold">{parsed.rows.length - importFailures.length}</strong> of{' '}
                <strong className="font-semibold">{parsed.rows.length}</strong> rows. Rows below could not be imported:
              </p>
              <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {importFailures.map((f) => (
                  <li
                    key={f.rowNumber}
                    className="border-b border-border/70 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="font-medium text-foreground">Row {f.rowNumber}</span>
                    <span className="text-foreground/85"> — {f.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            {importFailures?.length ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={submitting || !parsed || parsed.rows.length === 0 || !hasAnyMapping}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'Importing…' : `Import ${parsed?.rows.length ?? 0} rows`}
          </button>
        </div>
      </div>
    </div>
  )
}
