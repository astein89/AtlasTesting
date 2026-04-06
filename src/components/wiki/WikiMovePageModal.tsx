import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { moveWikiPage } from '@/api/wiki'
import { validateWikiFullPath } from '@/lib/wikiPaths'

const HINT =
  'Use letters, digits, and hyphens. Example: guides/my-page or new-nested/page.'

export function WikiMovePageModal({
  open,
  fromPath,
  onClose,
  onMoved,
}: {
  open: boolean
  fromPath: string
  onClose: () => void
  onMoved: (newPath: string) => void
}) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setValue(fromPath)
    setFieldError(null)
    setSubmitError(null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, fromPath])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, busy])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    const to = validateWikiFullPath(value)
    if (!to) {
      setFieldError(HINT)
      return
    }
    if (to === fromPath) {
      setFieldError('Choose a different path than the current one.')
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      await moveWikiPage(fromPath, to)
      onMoved(to)
      onClose()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not move page.'
      setSubmitError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const modal = (
    <div
      className="fixed inset-0 z-[110] flex min-h-0 items-center justify-center bg-black/60 p-4"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="mx-auto w-full max-w-md shrink-0 rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            Move page
          </h2>
          <p className="mt-1 text-xs text-foreground/65">
            Renames the page or section on disk (including subpages under a section).
          </p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="px-4 py-4">
          <p className="mb-2 text-xs font-medium text-foreground/55">Current path</p>
          <p className="mb-3 font-mono text-sm text-foreground">{fromPath || '(root)'}</p>
          <label htmlFor="wiki-move-to" className="mb-1 block text-xs font-medium text-foreground/70">
            New path
          </label>
          <input
            ref={inputRef}
            id="wiki-move-to"
            type="text"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setFieldError(null)
              setSubmitError(null)
            }}
            disabled={busy}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary focus:ring-2 disabled:opacity-60"
          />
          {fieldError ? <p className="mt-2 text-sm text-destructive">{fieldError}</p> : null}
          {submitError ? <p className="mt-2 text-sm text-destructive">{submitError}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Moving…' : 'Move'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
