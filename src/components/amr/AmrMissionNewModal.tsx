import { useEffect, useState } from 'react'
import { AmrMissionNewForm, MissionErrorBanner } from '@/routes/amr/AmrMissionNew'

export function AmrMissionNewModal({
  open,
  onClose,
  initialSearch,
}: {
  open: boolean
  onClose: () => void
  initialSearch?: string
}) {
  const [missionError, setMissionError] = useState('')
  const [clearErrorsNonce, setClearErrorsNonce] = useState(0)

  useEffect(() => {
    if (!open) {
      setMissionError('')
      setClearErrorsNonce(0)
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
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 id="amr-new-mission-title" className="text-lg font-semibold tracking-tight text-foreground">
            New Mission
          </h2>
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
            variant="modal"
            initialSearch={initialSearch}
            onRequestClose={onClose}
            onMissionErrorChange={setMissionError}
            clearMissionErrorsNonce={clearErrorsNonce}
          />
        </div>
      </div>
    </div>
  )
}
