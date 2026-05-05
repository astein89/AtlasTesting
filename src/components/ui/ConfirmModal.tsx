import { useEffect, type ReactNode } from 'react'

interface ConfirmModalProps {
  open: boolean
  title?: string
  message: string | ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  /** When true, clicking the backdrop dismisses. Default false. */
  closeOnBackdropClick?: boolean
  /** When false, Escape does not dismiss. Default true. */
  closeOnEscape?: boolean
  /** Show an X control in the header that calls onCancel. Default true. */
  showHeaderClose?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Custom modal replacing window.confirm() for better visibility on all devices.
 * Uses large touch targets, scrollable content, and clear backdrop.
 * Product standard: backdrop does not dismiss unless `closeOnBackdropClick` is explicitly set (default false).
 */
export function ConfirmModal({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'default',
  closeOnBackdropClick = false,
  closeOnEscape = true,
  showHeaderClose = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onCancel, closeOnEscape])

  if (!open) return null

  const confirmClass =
    variant === 'danger'
      ? 'min-h-[44px] min-w-[100px] rounded-lg border border-red-500/50 px-4 py-2 text-red-600 hover:bg-red-500/10 dark:text-red-400'
      : 'min-h-[44px] min-w-[100px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={closeOnBackdropClick ? onCancel : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
          <h2
            id="confirm-modal-title"
            className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold leading-tight text-foreground"
          >
            {title}
          </h2>
          {showHeaderClose && (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground"
              aria-label="Cancel"
            >
              <span className="text-2xl leading-none" aria-hidden>
                ×
              </span>
            </button>
          )}
        </div>
        <div
          id="confirm-modal-desc"
          className={
            typeof message === 'string'
              ? 'min-h-[44px] flex-1 overflow-y-auto whitespace-pre-line px-4 py-4 text-sm leading-relaxed text-foreground'
              : 'min-h-[44px] flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-foreground'
          }
        >
          {message}
        </div>
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
