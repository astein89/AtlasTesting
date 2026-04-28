import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { fetchWikiSlugSuggestion } from '@/api/wiki'
import { parseWikiPathSegment, slugifyWikiTitleToSegment } from '@/lib/wikiPaths'

const NEST_HINT = 'Parent folder for the new page, from existing wiki locations.'

const SLUG_HINT =
  'Last segment of the URL. Suggested from the new name until you edit it.'

function parentPathOf(normalized: string): string {
  const segs = normalized.split('/').filter(Boolean)
  if (segs.length <= 1) return ''
  return segs.slice(0, -1).join('/')
}

function nestOptionLabel(path: string): string {
  if (!path) return 'Wiki root'
  return path
}

export function WikiDuplicatePageModal({
  open,
  sourcePagePath,
  initialTitle,
  nestParentOptions,
  onClose,
  onConfirm,
}: {
  open: boolean
  /** Normalized path of the page being copied. */
  sourcePagePath: string
  initialTitle: string
  /** Distinct parent paths (include '' for wiki root), from `wikiNestParentPathOptions`. */
  nestParentOptions: string[]
  onClose: () => void
  onConfirm: (newNormalizedPath: string, pageTitle: string) => Promise<void>
}) {
  const titleId = useId()
  const selectId = useId()
  const titleRef = useRef<HTMLInputElement>(null)
  const slugTouchedRef = useRef(false)
  const [nestUnder, setNestUnder] = useState('')
  const [title, setTitle] = useState('')
  const [slugInput, setSlugInput] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const want = parentPathOf(sourcePagePath)
    const opts = nestParentOptions
    const next = opts.includes(want) ? want : opts[0] ?? ''
    setNestUnder(next)
    setTitle(initialTitle.trim() || '')
    setSlugInput('')
    slugTouchedRef.current = false
    setFieldError(null)
    setSubmitError(null)
    window.requestAnimationFrame(() => {
      titleRef.current?.focus()
    })
  }, [open, sourcePagePath, initialTitle, nestParentOptions])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, busy])

  useEffect(() => {
    if (!open || slugTouchedRef.current || !title.trim()) return
    const parentForSlug = nestUnder
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { slug } = await fetchWikiSlugSuggestion(parentForSlug, title.trim(), controller.signal)
          if (!slugTouchedRef.current) setSlugInput(slug)
        } catch (e: unknown) {
          if (controller.signal.aborted) return
          if (!slugTouchedRef.current) setSlugInput(slugifyWikiTitleToSegment(title))
        }
      })()
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [title, open, nestUnder])

  const resolvedPathPreview = useMemo(() => {
    const seg = parseWikiPathSegment(slugInput)
    if (!title.trim() || !seg) return null
    return nestUnder ? `${nestUnder}/${seg}` : seg
  }, [title, slugInput, nestUnder])

  const handleTitleChange = (v: string) => {
    setTitle(v)
    setFieldError(null)
    setSubmitError(null)
    if (!slugTouchedRef.current) {
      setSlugInput(v.trim() ? slugifyWikiTitleToSegment(v) : '')
    }
  }

  const handleSlugChange = (v: string) => {
    slugTouchedRef.current = true
    setSlugInput(v)
    setFieldError(null)
    setSubmitError(null)
  }

  const handleNestChange = (v: string) => {
    setNestUnder(v)
    setFieldError(null)
    setSubmitError(null)
  }

  const runDuplicate = async (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitError(null)

    if (!title.trim()) {
      setFieldError('Enter a name for the new page.')
      titleRef.current?.focus()
      return
    }

    const parentNorm = nestUnder

    const seg = parseWikiPathSegment(slugInput)
    if (!seg) {
      setFieldError(SLUG_HINT)
      return
    }

    const newPath = parentNorm ? `${parentNorm}/${seg}` : seg
    if (newPath === sourcePagePath) {
      setFieldError('Path must differ from the current page. Change the folder or the slug.')
      return
    }

    setFieldError(null)
    setBusy(true)
    try {
      await onConfirm(newPath, title.trim())
      onClose()
    } catch (err: unknown) {
      const apiMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      const msg =
        apiMsg ??
        (err instanceof Error && err.message.trim() ? err.message : null) ??
        'Could not save the duplicate page.'
      setSubmitError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center bg-black/60 p-4 print:hidden"
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
            Duplicate page
          </h2>
          <p className="mt-1 text-sm text-foreground/65">
            Choose a name and where the copy should live. Markdown and view permissions are copied from the
            current page.
          </p>
        </div>
        <form className="px-4 py-4" onSubmit={(ev) => void runDuplicate(ev)}>
          <label htmlFor="wiki-dup-title" className="mb-1 block text-xs font-medium text-foreground/70">
            New page name
          </label>
          <input
            ref={titleRef}
            id="wiki-dup-title"
            type="text"
            autoComplete="off"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="My page copy"
            disabled={busy}
            className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 outline-none ring-primary focus:ring-2 disabled:opacity-60"
          />

          <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-foreground/70">
            Nest under
          </label>
          <select
            id={selectId}
            value={nestUnder}
            onChange={(e) => handleNestChange(e.target.value)}
            disabled={busy}
            className="mb-1 min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary focus:ring-2 disabled:opacity-60"
          >
            {nestParentOptions.map((p) => (
              <option key={p || '__root__'} value={p}>
                {nestOptionLabel(p)}
              </option>
            ))}
          </select>
          <p className="mb-3 text-xs text-foreground/55">{NEST_HINT}</p>

          <label htmlFor="wiki-dup-slug" className="mb-1 block text-xs font-medium text-foreground/70">
            Slug
          </label>
          <input
            id="wiki-dup-slug"
            type="text"
            autoComplete="off"
            value={slugInput}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="my-page-copy"
            disabled={busy}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-foreground/40 outline-none ring-primary focus:ring-2 disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-foreground/55">{SLUG_HINT}</p>

          <div className="mt-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2 dark:bg-foreground/[0.06]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/55">Full path</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">{resolvedPathPreview ?? '—'}</p>
          </div>

          {fieldError ? <p className="mt-2 text-sm text-destructive">{fieldError}</p> : null}
          {submitError ? <p className="mt-2 text-sm text-destructive">{submitError}</p> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
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
              className="min-h-[44px] rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Duplicate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
