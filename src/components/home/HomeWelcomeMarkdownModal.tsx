import { useEffect, useState } from 'react'
import { WikiMarkdownEditor } from '@/components/wiki/WikiMarkdownEditor'

interface HomeWelcomeMarkdownModalProps {
  open: boolean
  /** Bump when opening so {@link WikiMarkdownEditor} clears undo/redo. */
  editorSessionKey: string
  initialMarkdown: string
  onClose: () => void
  /** Persist draft into parent home edit state. */
  onApply: (markdown: string) => void
}

export function HomeWelcomeMarkdownModal({
  open,
  editorSessionKey,
  initialMarkdown,
  onClose,
  onApply,
}: HomeWelcomeMarkdownModalProps) {
  const [draft, setDraft] = useState(initialMarkdown)

  useEffect(() => {
    if (open) setDraft(initialMarkdown)
  }, [open, initialMarkdown])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-welcome-md-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
          <h2 id="home-welcome-md-title" className="text-base font-semibold text-foreground sm:text-lg">
            Welcome content
          </h2>
          <p className="mt-1 text-xs text-foreground/70 sm:text-sm">
            Same Markdown tools as the wiki editor — headings, lists, code, emoji, live preview, undo/redo, and help.
            Apply saves into this screen; use Save on the home page editor to write to the server. Clicking outside does
            not close this window; use Cancel or Apply.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
          <WikiMarkdownEditor
            value={draft}
            onChange={setDraft}
            layout="modal"
            historyResetKey={editorSessionKey}
          />
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
