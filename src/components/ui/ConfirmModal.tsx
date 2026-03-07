import { useEffect } from 'react'

interface ConfirmModalProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Custom modal replacing window.confirm() for better visibility on all devices.
 * Uses large touch targets, scrollable content, and clear backdrop.
 */
export function ConfirmModal({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onCancel])

  if (!open) return null

  const confirmClass =
    variant === 'danger'
      ? 'min-h-[44px] min-w-[100px] rounded-lg border border-red-500/50 px-4 py-2 text-red-600 hover:bg-red-500/10 dark:text-red-400'
      : 'min-h-[44px] min-w-[100px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="shrink-0 border-b border-border px-4 py-3 text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p id="confirm-modal-desc" className="min-h-[44px] flex-1 overflow-y-auto px-4 py-4 text-foreground">
          {message}
        </p>
        <div className="flex shrink-0 flex-wrap gap-3 border-t border-border px-4 py-3">
          <button type="button" onClick={onCancel} className="min-h-[44px] min-w-[100px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={confirmClass}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
