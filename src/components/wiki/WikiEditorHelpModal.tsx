import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchWikiPage } from '@/api/wiki'
import { wikiEditUrl, wikiPageUrl } from '@/lib/appPaths'
import { MarkdownMdRtView } from '@/components/markdown/MarkdownMdRtView'

const HELP_MARKDOWN_PATH = 'guides/help-markdown'
const HELP_MERMAID_PATH = 'guides/help-mermaid'

type Tab = 'markdown' | 'mermaid'

export function WikiEditorHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('markdown')
  const [markdownBody, setMarkdownBody] = useState('')
  const [mermaidBody, setMermaidBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [md, mg] = await Promise.all([
          fetchWikiPage(HELP_MARKDOWN_PATH),
          fetchWikiPage(HELP_MERMAID_PATH),
        ])
        if (cancelled) return
        setMarkdownBody(md.markdown)
        setMermaidBody(mg.markdown)
      } catch {
        if (!cancelled) {
          setError('Could not load help pages. Ensure the wiki includes guides/help-markdown and guides/help-mermaid.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const activeSource = tab === 'markdown' ? markdownBody : mermaidBody
  const activePath = tab === 'markdown' ? HELP_MARKDOWN_PATH : HELP_MERMAID_PATH

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wiki-editor-help-title"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
          <h2
            id="wiki-editor-help-title"
            className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold text-foreground"
          >
            Editor help
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground"
            aria-label="Close"
          >
            <span className="text-2xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-2">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'markdown'}
            onClick={() => setTab('markdown')}
            className={`rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium ${
              tab === 'markdown'
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-foreground/70 hover:text-foreground'
            }`}
          >
            Markdown
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mermaid'}
            onClick={() => setTab('mermaid')}
            className={`rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium ${
              tab === 'mermaid'
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-foreground/70 hover:text-foreground'
            }`}
          >
            Mermaid
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="text-sm text-foreground/60">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <MarkdownMdRtView content={activeSource} />
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="text-xs text-foreground/60">
            Full pages in the wiki:{' '}
            <Link
              to={wikiPageUrl(HELP_MARKDOWN_PATH)}
              className="text-primary underline underline-offset-2"
              onClick={onClose}
            >
              Markdown help
            </Link>
            {' · '}
            <Link
              to={wikiPageUrl(HELP_MERMAID_PATH)}
              className="text-primary underline underline-offset-2"
              onClick={onClose}
            >
              Mermaid help
            </Link>
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to={wikiEditUrl(activePath)}
              className="min-h-[40px] rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
              onClick={onClose}
            >
              Edit this page
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
