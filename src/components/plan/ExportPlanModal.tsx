import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { recordsToCsv } from '../../utils/csvExport'

async function fetchPhotoBlob(path: string): Promise<Blob | null> {
  const url = path.startsWith('http') ? path : `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`
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
  testName: string
  recordedAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean | string[]>
}

interface ExportPlanModalProps {
  planId: string
  planName: string
  /** When set, only export this test (hides test selection) */
  testId?: string
  testName?: string
  onClose: () => void
}

export function ExportPlanModal({ planId, planName, testId: singleTestId, testName: singleTestName, onClose }: ExportPlanModalProps) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [includeCsv, setIncludeCsv] = useState(true)
  const [includePhotos, setIncludePhotos] = useState(false)
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const baseParams: Record<string, string> = { limit: '5000' }
    if (from) baseParams.from = from
    if (to) baseParams.to = to

    setLoading(true)
    if (singleTestId) {
      api
        .get<Record[]>('/records', {
          params: { ...baseParams, testId: singleTestId },
        })
        .then((r) => setRecords(r.data))
        .catch(() => setRecords([]))
        .finally(() => setLoading(false))
    } else {
      api
        .get<Record[]>('/records', {
          params: { ...baseParams, testPlanId: planId },
        })
        .then((r) => setRecords(r.data))
        .catch(() => setRecords([]))
        .finally(() => setLoading(false))
    }
  }, [planId, singleTestId, from, to])

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

  const exportBaseName = (singleTestName || planName).replace(/[^a-z0-9]/gi, '-')
  const dateStr = new Date().toISOString().slice(0, 10)

  const hasPhotos = records.some((r) =>
    Object.values(r.data).some((v) => {
      const arr = Array.isArray(v) ? v : v ? [v] : []
      return arr.some((p) => typeof p === 'string' && p.includes('/api/uploads/'))
    })
  )

  const fileCount = (includeCsv ? 1 : 0) + (includePhotos && hasPhotos ? 1 : 0)

  const handleExport = async () => {
    if (records.length === 0 || (!includeCsv && (!includePhotos || !hasPhotos))) return
    setExporting(true)
    try {
      if (fileCount === 1) {
        if (includeCsv) {
          const csv = recordsToCsv(records)
          const blob = new Blob([csv], { type: 'text/csv' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${exportBaseName}-export-${dateStr}.csv`
          a.click()
          URL.revokeObjectURL(url)
        } else {
          const zip = new JSZip()
          let photoIndex = 0
          for (const record of records) {
            for (const [key, val] of Object.entries(record.data)) {
              const paths = Array.isArray(val) ? val : val ? [val] : []
              for (let i = 0; i < paths.length; i++) {
                const p = paths[i] as string
                if (typeof p !== 'string' || !p.includes('/api/uploads/')) continue
                const blob = await fetchPhotoBlob(p)
                if (blob) {
                  const ext = p.split('.').pop() || 'jpg'
                  zip.file(`photos/${photoIndex}.${ext}`, blob)
                  photoIndex++
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
        }
      } else {
        const zip = new JSZip()
        if (includeCsv) {
          zip.file('data.csv', recordsToCsv(records))
        }
        if (includePhotos && hasPhotos) {
          let photoIndex = 0
          for (const record of records) {
            for (const [key, val] of Object.entries(record.data)) {
              const paths = Array.isArray(val) ? val : val ? [val] : []
              for (let i = 0; i < paths.length; i++) {
                const p = paths[i] as string
                if (typeof p !== 'string' || !p.includes('/api/uploads/')) continue
                const blob = await fetchPhotoBlob(p)
                if (blob) {
                  const ext = p.split('.').pop() || 'jpg'
                  zip.file(`photos/${photoIndex}.${ext}`, blob)
                  photoIndex++
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
      }
    } catch (err) {
      console.error('Export failed:', err)
      alert(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
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
          Export: {singleTestName ? singleTestName : planName}
        </h2>

        <div className="space-y-4">
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
            {loading ? 'Loading...' : `${records.length} record(s) will be exported.`}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={
              records.length === 0 ||
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
