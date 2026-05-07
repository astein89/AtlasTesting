import { useEffect, useRef, useState } from 'react'
import {
  AmrMissionNewForm,
  MissionErrorBanner,
  type AmrMissionNewFormHandle,
} from '@/routes/amr/AmrMissionNew'
import { useAuthStore } from '@/store/authStore'

export function AmrMissionNewModal({
  open,
  onClose,
  initialSearch,
}: {
  open: boolean
  onClose: () => void
  initialSearch?: string
}) {
  const formRef = useRef<AmrMissionNewFormHandle>(null)
  const canManage = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const canAmrModule = useAuthStore((s) => s.hasPermission('module.amr'))
  const canAmrApiDebug = useAuthStore((s) => s.hasPermission('amr.tools.dev'))
  const [missionError, setMissionError] = useState('')
  const [clearErrorsNonce, setClearErrorsNonce] = useState(0)
  const [standsRefresh, setStandsRefresh] = useState<{ canRefresh: boolean; loading: boolean }>({
    canRefresh: false,
    loading: false,
  })

  useEffect(() => {
    if (!open) {
      setMissionError('')
      setClearErrorsNonce(0)
      setStandsRefresh({ canRefresh: false, loading: false })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex min-h-0 items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="amr-new-mission-title"
        className="relative z-10 flex h-full min-h-0 max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:h-auto sm:max-h-[min(90vh,100dvh)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-nowrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
          <h2
            id="amr-new-mission-title"
            className="min-w-0 flex-1 truncate pr-1 text-base font-semibold tracking-tight text-foreground sm:pr-2 sm:text-lg"
          >
            New Mission
          </h2>
          <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={!standsRefresh.canRefresh || standsRefresh.loading}
              className="inline-flex min-h-9 min-w-0 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 sm:min-h-[44px] sm:px-3 sm:text-sm md:px-4"
              onClick={() => formRef.current?.refreshStands()}
            >
              {standsRefresh.loading ? 'Refreshing…' : 'Refresh stands'}
            </button>
            {canAmrApiDebug ? (
              <button
                type="button"
                className="inline-flex min-h-9 min-w-0 items-center justify-center rounded-lg border border-dashed border-red-500/45 bg-red-500/[0.06] px-2.5 text-xs text-red-700 hover:bg-red-500/10 sm:min-h-[44px] sm:px-3 sm:text-sm dark:border-red-500/35 dark:bg-red-500/[0.08] dark:text-red-300 dark:hover:bg-red-500/15 md:px-4"
                onClick={() => formRef.current?.openDebug()}
              >
                <span className="sm:hidden">Debug</span>
                <span className="hidden sm:inline">Debug…</span>
              </button>
            ) : null}
            {canManage && canAmrModule ? (
              <button
                type="button"
                className="inline-flex min-h-9 min-w-0 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted sm:min-h-[44px] sm:px-3 sm:text-sm md:px-4"
                onClick={() => formRef.current?.openSaveTemplate()}
              >
                <span className="sm:hidden">Save…</span>
                <span className="hidden sm:inline">Save template</span>
              </button>
            ) : null}
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
        </div>
        <MissionErrorBanner
          flush
          message={missionError}
          onDismiss={() => {
            setMissionError('')
            setClearErrorsNonce((n) => n + 1)
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5">
          <AmrMissionNewForm
            ref={formRef}
            variant="modal"
            initialSearch={initialSearch}
            onRequestClose={onClose}
            onMissionErrorChange={setMissionError}
            clearMissionErrorsNonce={clearErrorsNonce}
            onMissionStandsRefreshState={setStandsRefresh}
          />
        </div>
      </div>
    </div>
  )
}
