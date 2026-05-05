import { useEffect, type ReactNode } from 'react'
import { MissionJobStatusBadge } from '@/components/amr/MissionJobStatusBadge'

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2.5 last:border-0 sm:grid sm:grid-cols-[minmax(8rem,11rem)_1fr] sm:items-start sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-foreground/55">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  )
}

export function AmrFleetJobDetailModal({
  job,
  onClose,
}: {
  job: Record<string, unknown> | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!job) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [job, onClose])

  if (!job) return null

  const jobCode = String(job.jobCode ?? '')
  const status = job.status

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fleet-job-detail-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg sm:max-h-[90vh] sm:max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p id="fleet-job-detail-title" className="text-xs font-medium uppercase tracking-wide text-foreground/55">
              Fleet job (not tracked in app)
            </p>
            <p className="mt-1 break-all font-mono text-base font-semibold leading-snug text-foreground">
              {jobCode || '—'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {typeof status === 'number' ? (
                <MissionJobStatusBadge value={status} />
              ) : (
                <span className="text-sm text-foreground/50">Unknown status</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-background hover:text-foreground"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <section className="rounded-lg border border-border bg-muted/20 px-3 py-1">
            <dl>
              <DetailRow label="Container">{String(job.containerCode ?? '—')}</DetailRow>
              <DetailRow label="Robot">{String(job.robotId ?? '—')}</DetailRow>
              <DetailRow label="Map">{String(job.mapCode ?? '—')}</DetailRow>
              <DetailRow label="Target cell">{String(job.targetCellCode ?? job.finalNodeCode ?? '—')}</DetailRow>
              <DetailRow label="Created (fleet)">{String(job.createTime ?? '—')}</DetailRow>
              <DetailRow label="Complete (fleet)">{String(job.completeTime ?? '—')}</DetailRow>
              <DetailRow label="Source">{String(job.source ?? '—')}</DetailRow>
            </dl>
          </section>

          <section className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/55">Raw fleet payload</h3>
            <pre className="max-h-[min(40vh,280px)] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
              {JSON.stringify(job, null, 2)}
            </pre>
          </section>
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
