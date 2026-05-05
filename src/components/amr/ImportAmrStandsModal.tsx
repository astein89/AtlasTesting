import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importAmrStandsCsv, type AmrStandImportFailure } from '@/api/amr'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { STAND_IMPORT_FIELDS, autoMapStandImportFields, buildStandImportCsv } from '@/utils/amrStandImport'
import { parseImportFile, type ParsedImportFile } from '@/utils/parseImportFile'
import { PopupSelect } from '@/components/ui/PopupSelect'

const DONT_MAP = ''

interface ImportAmrStandsModalProps {
  onClose: () => void
  onImported: () => void
}

export function ImportAmrStandsModal({ onClose, onImported }: ImportAmrStandsModalProps) {
  const { showAlert } = useAlertConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedImportFile | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fieldToColumn, setFieldToColumn] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [importSummary, setImportSummary] = useState<{
    imported: number
    failures: AmrStandImportFailure[]
  } | null>(null)

  const columnOptions = useMemo(() => {
    const headers = parsed?.headers ?? []
    return headers.map((h) => ({ value: h, label: h }))
  }, [parsed?.headers])

  const headersSig = useMemo(() => (parsed?.headers ?? []).join('\0'), [parsed?.headers])
  const autoMappedKeyRef = useRef<string>('')

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setParseError(null)
    setParsed(null)
    setImportSummary(null)
    setFieldToColumn({})
    autoMappedKeyRef.current = ''
    parseImportFile(f)
      .then(setParsed)
      .catch((err: unknown) => setParseError(err instanceof Error ? err.message : 'Failed to parse file'))
  }, [])

  useEffect(() => {
    if (!parsed?.headers.length) return
    if (autoMappedKeyRef.current === headersSig) return
    autoMappedKeyRef.current = headersSig
    setFieldToColumn(autoMapStandImportFields(parsed.headers))
  }, [parsed, headersSig])

  const hasExternalRefMapping = !!fieldToColumn.external_ref

  const handleImport = useCallback(async () => {
    if (!parsed || parsed.rows.length === 0) {
      showAlert('No data rows to import.')
      return
    }
    if (!hasExternalRefMapping) {
      showAlert('Map Location (External Ref) to a column — required for each row.')
      return
    }
    setSubmitting(true)
    setImportSummary(null)
    try {
      const csv = buildStandImportCsv(parsed, fieldToColumn)
      const result = await importAmrStandsCsv(csv)
      setImportSummary({ imported: result.imported, failures: result.failures ?? [] })
      if (result.imported > 0) onImported()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Import failed')
    } finally {
      setSubmitting(false)
    }
  }, [parsed, hasExternalRefMapping, fieldToColumn, onImported, showAlert])

  const previewRows = useMemo(() => (parsed?.rows ?? []).slice(0, 5), [parsed?.rows])

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold text-foreground">Import stands from file</h2>
          <button
            type="button"
            onClick={() => {
              setImportSummary(null)
              onClose()
            }}
            className="rounded p-1 text-foreground/70 hover:bg-background hover:text-foreground"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-foreground">File (CSV)</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1 file:text-primary-foreground"
            />
            {file ? (
              <p className="mt-1 text-xs text-foreground/70">
                Selected: <span className="font-mono">{file.name}</span>
              </p>
            ) : null}
            {parseError && <p className="mt-2 text-sm text-red-500">{parseError}</p>}
            {parsed && (
              <p className="mt-2 text-sm text-foreground/80">
                Detected {parsed.headers.length} column{parsed.headers.length !== 1 ? 's' : ''},{' '}
                {parsed.rows.length} data row{parsed.rows.length !== 1 ? 's' : ''}.
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

          {parsed && parsed.rows.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-foreground">Map columns to stand fields</h3>
              <p className="mb-2 text-xs text-foreground/70">
                Columns are auto-matched when headers match field names or labels (including exports from this app).
                Change any mapping below if needed. Location (External Ref) must be mapped.
              </p>
              <div className="grid grid-cols-[minmax(120px,280px)_240px] items-center gap-x-4 gap-y-2">
                {STAND_IMPORT_FIELDS.map((field) => (
                  <div key={field.key} className="contents">
                    <span className="break-words text-sm text-foreground">
                      {field.label}
                      {field.key === 'external_ref' ? (
                        <span className="text-red-600 dark:text-red-400"> *</span>
                      ) : null}
                    </span>
                    <PopupSelect
                      value={fieldToColumn[field.key] ?? DONT_MAP}
                      onChange={(v) =>
                        setFieldToColumn((prev) => ({ ...prev, [field.key]: v }))
                      }
                      options={columnOptions}
                      emptyOption="— Don't map —"
                      className="w-[240px] shrink-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {importSummary ? (
            <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground">
                Imported {importSummary.imported} stand{importSummary.imported !== 1 ? 's' : ''}.
              </p>
              {importSummary.failures.length > 0 ? (
                <div className="mt-3">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    Not imported ({importSummary.failures.length} row
                    {importSummary.failures.length !== 1 ? 's' : ''})
                  </p>
                  <p className="mt-1 text-xs text-foreground/65">
                    CSV line numbers include the header as line 1.
                  </p>
                  <div className="mt-2 max-h-[min(220px,40vh)] overflow-auto rounded border border-border bg-card">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-2 py-1.5 font-medium text-foreground">Line</th>
                          <th className="px-2 py-1.5 font-medium text-foreground">Location</th>
                          <th className="px-2 py-1.5 font-medium text-foreground">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importSummary.failures.map((f, i) => (
                          <tr key={`${f.line}-${i}`} className="border-b border-border/80 last:border-0">
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-foreground">
                              {f.line}
                            </td>
                            <td className="max-w-[140px] break-all px-2 py-1.5 font-mono text-foreground">
                              {f.external_ref ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 text-foreground/90">{f.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setImportSummary(null)
              onClose()
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            {importSummary ? 'Close' : 'Cancel'}
          </button>
          {importSummary ? (
            <button
              type="button"
              onClick={() => setImportSummary(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
            >
              Import again
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={submitting || !parsed || parsed.rows.length === 0 || !hasExternalRefMapping}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'Importing…' : `Import ${parsed?.rows.length ?? 0} rows`}
          </button>
        </div>
      </div>
    </div>
  )
}
