import { useEffect, type ReactNode } from 'react'
import { ConfirmModalActionsProvider } from '@/contexts/ConfirmModalContext'

interface ConfirmModalProps {
  open: boolean
  title?: string
  message: string | ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `amber` matches mission overview “Release Mission” (outlined amber). */
  variant?: 'danger' | 'default' | 'amber'
  /** When true, clicking the backdrop dismisses. Default false. */
  closeOnBackdropClick?: boolean
  /** When false, Escape does not dismiss. Default true. */
  closeOnEscape?: boolean
  /** Show an X control in the header that calls onCancel. Default true. */
  showHeaderClose?: boolean
  /** Footer button row: start (default) or end (right-aligned group). */
  alignActions?: 'start' | 'end'
  /** Inserted between Cancel and the confirm button (e.g. secondary confirm). */
  footerExtra?: ReactNode
  /**
   * Hide the footer Cancel button (header × still calls `onCancel`). Use only when `showHeaderClose` is true.
   * Helps fit Retry + primary on one row on narrow screens.
   */
  omitFooterCancel?: boolean
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
  alignActions = 'start',
  footerExtra,
  omitFooterCancel = false,
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

  /**
   * Footer buttons stay compact at every viewport width. Tailwind `sm:` breakpoints follow the *viewport*,
   * so a wide monitor would keep huge buttons inside this `max-w-md` modal — that looked like “no change”.
   */
  const compactBtn =
    'min-h-[36px] shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium leading-snug'

  const confirmClass =
    variant === 'danger'
      ? `${compactBtn} border border-red-500/50 text-red-600 hover:bg-red-500/10 dark:text-red-400`
      : variant === 'amber'
        ? `${compactBtn} border border-amber-500/40 bg-amber-500/10 text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35`
        : `${compactBtn} bg-primary text-primary-foreground hover:opacity-90`

  const cancelClass = `${compactBtn} border border-border text-foreground hover:bg-background`

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
              className="flex h-9 min-w-[40px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground"
              aria-label={omitFooterCancel ? 'Close' : 'Cancel'}
            >
              <span className="text-2xl leading-none" aria-hidden>
                ×
              </span>
            </button>
          )}
        </div>
        <ConfirmModalActionsProvider confirm={onConfirm} cancel={onCancel}>
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
          <div
            className={`flex shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto border-t border-border px-2 py-2 ${
              alignActions === 'end' ? 'justify-end' : ''
            }`}
          >
            {!omitFooterCancel ? (
              <button type="button" onClick={onCancel} className={cancelClass}>
                {cancelLabel}
              </button>
            ) : null}
            {footerExtra}
            <button
              type="button"
              onClick={onConfirm}
              className={`${confirmClass} max-w-[13rem] whitespace-normal text-center leading-snug`}
            >
              {confirmLabel}
            </button>
          </div>
        </ConfirmModalActionsProvider>
      </div>
    </div>
  )
}
