import { useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { api } from '../../api/client'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'
import { useAuthStore } from '../../store/authStore'
import { getBasePath } from '../../lib/basePath'
import { recordsToCsv } from '../../utils/csvExport'
import { sanitizeForLog } from '../../utils/sanitizeLog'
import { getElapsedMs } from '../../utils/timer'
import type { DataField, TimerValue } from '../../types'

async function fetchPhotoBlob(path: string): Promise<Blob | null> {
  const url = path.startsWith('http') ? path : `${window.location.origin}${getBasePath()}${path.startsWith('/') ? '' : '/'}${path}`
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await fetch(url, { credentials: 'include', headers })
    if (!res.ok) return null
    return res.blob()
  } catch {
    return null
  }
}

interface Record {
  id: string
  planName: string
  recordedAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
  runId?: string
}

type SortLevel = { key: string; dir: 'asc' | 'desc' }

const FALLBACK_SORT: SortLevel[] = [{ key: 'date', dir: 'desc' }]

interface ExportPlanModalProps {
  planId: string
  planName: string
  onClose: () => void
  /** When provided (e.g. from data view), user can choose to export only these filtered records */
  filteredRecords?: Record[] | null
  /** When provided, export order uses this sort (e.g. plan default sort). */
  defaultSortOrder?: SortLevel[] | null
  /** Optional field key; when exporting a single record, its value is used in the filename */
  keyField?: string
  /** Plan fields (for image_tag when naming exported photos: key_field + image_tag + MMDDYYHHMMSS) */
  fields?: DataField[]
  /** Optional explicit order of data field keys (e.g. from data table). */
  fieldOrderKeys?: string[]
  /** Optional ordered list of field ids and separator ids (newline-xxx) for form layout; used to derive CSV order when no fieldOrderKeys. */
  formLayoutOrder?: string[]
}

function getVal(r: Record, key: string): string | number | boolean | string[] | TimerValue {
  if (key === 'date') return r.recordedAt
  return r.data[key] ?? ''
}

function isTimerVal(v: unknown): v is TimerValue {
  return typeof v === 'object' && v !== null && 'totalElapsedMs' in v
}

function compare(
  aVal: string | number | boolean | string[] | TimerValue,
  bVal: string | number | boolean | string[] | TimerValue,
  dir: 'asc' | 'desc'
): number {
  if (isTimerVal(aVal) && isTimerVal(bVal)) {
    const cmp = getElapsedMs(aVal) - getElapsedMs(bVal)
    return dir === 'asc' ? cmp : -cmp
  }
  const aStr = String(aVal)
  const bStr = String(bVal)
  const numA = Number(aVal)
  const numB = Number(bVal)
  let cmp: number
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
    cmp = numA - numB
  } else {
    cmp = aStr.localeCompare(bStr, undefined, { sensitivity: 'base' })
  }
  return dir === 'asc' ? cmp : -cmp
}

function sortRecordsBy(records: Record[], sortOrder: SortLevel[]): Record[] {
  if (!sortOrder.length) return records
  const copy = [...records]
  copy.sort((a, b) => {
    for (const { key, dir } of sortOrder) {
      const cmp = compare(getVal(a, key), getVal(b, key), dir)
      if (cmp !== 0) return cmp
    }
    return 0
  })
  return copy
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'export'
}

/** MMDDYYHHMMSS from record's recordedAt (ISO string) */
function formatRecordTimestamp(recordedAt: string): string {
  const d = new Date(recordedAt)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear() % 100).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${mm}${dd}${yy}${hh}${min}${ss}`
}

function sanitizePhotoNamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'image'
}

/** Build export photo filename: key_field + image_tag + MMDDYYHHMMSS + (_index if multiple) */
function getExportPhotoFilename(
  record: Record,
  fieldKey: string,
  photoIndex: number,
  keyField: string | undefined,
  fields: DataField[] | undefined,
  path: string
): string {
  if (keyField && fields?.length) {
    const keyFieldVal = sanitizePhotoNamePart(String(record.data[keyField] ?? '').trim() || 'record')
    const imageTag = sanitizePhotoNamePart(
      fields.find((f) => f.key === fieldKey)?.config?.imageTag ?? 'image'
    )
    const timestamp = formatRecordTimestamp(record.recordedAt)
    const ext = path.match(/\.[^.]+$/i)?.[0]?.toLowerCase() || '.jpg'
    const base = photoIndex > 0 ? `${keyFieldVal}_${imageTag}_${timestamp}_${photoIndex}` : `${keyFieldVal}_${imageTag}_${timestamp}`
    return `${base}${ext.startsWith('.') ? ext : '.' + ext}`
  }
  const name = path.split('/').pop() || 'photo'
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'photo.jpg'
}

function uniqueZipPath(used: Set<string>, dir: string, filename: string): string {
  let candidate = `${dir}/${filename}`
  let n = 0
  while (used.has(candidate)) {
    const noExt = filename.replace(/\.[^.]+$/i, '')
    const ext = filename.match(/\.[^.]+$/i)?.[0] || '.jpg'
    candidate = `${dir}/${noExt}_${++n}${ext}`
  }
  used.add(candidate)
  return candidate
}

export function ExportPlanModal({
  planId,
  planName,
  onClose,
  filteredRecords,
  defaultSortOrder,
  keyField,
  fields,
  fieldOrderKeys,
  formLayoutOrder,
}: ExportPlanModalProps) {
  const { showAlert } = useAlertConfirm()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [includeCsv, setIncludeCsv] = useState(true)
  const [includePhotos, setIncludePhotos] = useState(false)
  const [exportScope, setExportScope] = useState<'all' | 'filtered'>(
    filteredRecords != null && filteredRecords.length > 0 ? 'filtered' : 'all'
  )
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const canExportFiltered = filteredRecords != null && filteredRecords.length > 0
  // Filtered = current view only (never other archived). All = fetched current-only records (with optional date range).
  const recordsToExport =
    exportScope === 'filtered' && canExportFiltered ? filteredRecords! : records

  const sortOrder = defaultSortOrder?.length ? defaultSortOrder : FALLBACK_SORT
  const sortedForExport = useMemo(
    () => sortRecordsBy(recordsToExport, sortOrder),
    [recordsToExport, sortOrder]
  )

  useEffect(() => {
    const baseParams: Record<string, string> = { limit: '5000' }
    if (from) baseParams.from = from
    if (to) baseParams.to = to

    setLoading(true)
    api
      .get<Record[]>('/records', {
        params: { ...baseParams, testPlanId: planId },
      })
      .then((r) => {
        // Export never includes archived data unless user is viewing/reinstating that run (handled via filteredRecords)
        const currentOnly = (r.data as Record[]).filter((rec) => !rec.runId)
        setRecords(currentOnly)
      })
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [planId, from, to])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const dateStr = new Date().toISOString().slice(0, 10)
  const exportBaseName =
    keyField && sortedForExport.length === 1
      ? sanitizeForFilename(String(sortedForExport[0].data[keyField] ?? planName))
      : planName.replace(/[^a-z0-9]/gi, '-')

  const uploadsPath = getBasePath() + '/api/uploads/'
  const hasPhotos = sortedForExport.some((r) =>
    Object.values(r.data).some((v) => {
      const arr = Array.isArray(v) ? v : v ? [v] : []
      return arr.some((p) => typeof p === 'string' && (p.includes(uploadsPath) || p.includes('/api/uploads/')))
    })
  )

  const fileCount = (includeCsv ? 1 : 0) + (includePhotos && hasPhotos ? 1 : 0)

  const handleExport = async () => {
    if (recordsToExport.length === 0 || (!includeCsv && (!includePhotos || !hasPhotos))) return
    setExporting(true)
    try {
      if (fileCount === 1) {
        if (includeCsv) {
          // Prefer explicit field order (from data table), otherwise derive from form layout (excluding separators).
          let orderedFieldKeys: string[] | undefined
          if (fieldOrderKeys && fieldOrderKeys.length > 0) {
            orderedFieldKeys = fieldOrderKeys
          } else if (formLayoutOrder && fields && formLayoutOrder.length > 0) {
            orderedFieldKeys = formLayoutOrder
              .filter((id) => !id.startsWith('newline-'))
              .map((id) => fields.find((f) => f.id === id)?.key)
              .filter((k): k is string => Boolean(k))
          }

          const csv = recordsToCsv(sortedForExport, {
            fieldOrder: orderedFieldKeys,
          })
          const blob = new Blob([csv], { type: 'text/csv' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${exportBaseName}-export-${dateStr}.csv`
          a.click()
          URL.revokeObjectURL(url)
          onClose()
        } else {
          const zip = new JSZip()
          const usedPaths = new Set<string>()
          for (const record of sortedForExport) {
            for (const [key, val] of Object.entries(record.data)) {
              const paths = Array.isArray(val) ? val : val ? [val] : []
              for (let i = 0; i < paths.length; i++) {
                const p = paths[i] as string
                if (typeof p !== 'string' || (!p.includes(uploadsPath) && !p.includes('/api/uploads/'))) continue
                const blob = await fetchPhotoBlob(p)
                if (blob) {
                  const filename = getExportPhotoFilename(record, key, i, keyField, fields, p)
                  const zipPath = uniqueZipPath(usedPaths, 'photos', filename)
                  zip.file(zipPath, blob)
                }
              }
            }
          }
          const content = await zip.generateAsync({ type: 'blob' })
          const url = URL.createObjectURL(content)
          const a = document.createElement('a')
          a.href = url
          a.download = `${exportBaseName}-photos-${dateStr}.zip`
          a.click()
          URL.revokeObjectURL(url)
          onClose()
        }
      } else {
        const zip = new JSZip()
        if (includeCsv) {
          zip.file('data.csv', recordsToCsv(sortedForExport))
        }
        if (includePhotos && hasPhotos) {
          const usedPaths = new Set<string>()
          for (const record of sortedForExport) {
            for (const [key, val] of Object.entries(record.data)) {
              const paths = Array.isArray(val) ? val : val ? [val] : []
              for (let i = 0; i < paths.length; i++) {
                const p = paths[i] as string
                if (typeof p !== 'string' || (!p.includes(uploadsPath) && !p.includes('/api/uploads/'))) continue
                const blob = await fetchPhotoBlob(p)
                if (blob) {
                  const filename = getExportPhotoFilename(record, key, i, keyField, fields, p)
                  const zipPath = uniqueZipPath(usedPaths, 'photos', filename)
                  zip.file(zipPath, blob)
                }
              }
            }
          }
        }
        const content = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(content)
        const a = document.createElement('a')
        a.href = url
        a.download = `${exportBaseName}-export-${dateStr}.zip`
        a.click()
        URL.revokeObjectURL(url)
        onClose()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Export failed:', sanitizeForLog(msg))
      showAlert(`Export failed: ${sanitizeForLog(msg)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg sm:rounded-lg sm:pb-6 sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Export: {planName}
        </h2>

        <div className="space-y-4">
          {canExportFiltered && (
            <div>
              <label className="block text-sm font-medium text-foreground">Export scope</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="exportScope"
                    checked={exportScope === 'all'}
                    onChange={() => setExportScope('all')}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground">All current (with date range below)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="exportScope"
                    checked={exportScope === 'filtered'}
                    onChange={() => setExportScope('filtered')}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground">
                    Current view ({filteredRecords!.length} record{filteredRecords!.length === 1 ? '' : 's'})
                  </span>
                </label>
              </div>
            </div>
          )}

          {(exportScope === 'all' || !canExportFiltered) && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">From date</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">To date</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground">Export format</label>
            <div className="mt-2 flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeCsv}
                  onChange={(e) => setIncludeCsv(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-foreground">CSV</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={includePhotos}
                  onChange={(e) => setIncludePhotos(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-foreground">Photos</span>
              </label>
            </div>
          </div>

          <p className="text-sm text-foreground/70">
            {exportScope === 'all' && loading
              ? 'Loading...'
              : `${recordsToExport.length} record(s) will be exported.`}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={
              recordsToExport.length === 0 ||
              (!includeCsv && (!includePhotos || !hasPhotos)) ||
              exporting
            }
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
