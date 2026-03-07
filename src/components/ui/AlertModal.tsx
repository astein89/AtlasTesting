import { useEffect } from 'react'

interface AlertModalProps {
  open: boolean
  title?: string
  message: string
  onClose: () => void
}

/**
 * Custom modal replacing window.alert() for better visibility on all devices.
 * Uses large touch targets, scrollable content, and clear backdrop.
 */
export function AlertModal({ open, title = 'Message', message, onClose }: AlertModalProps) {
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alert-modal-title"
      aria-describedby="alert-modal-desc"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="alert-modal-title" className="shrink-0 border-b border-border px-4 py-3 text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p id="alert-modal-desc" className="min-h-[44px] flex-1 overflow-y-auto px-4 py-4 text-foreground">
          {message}
        </p>
        <div className="shrink-0 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[120px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
