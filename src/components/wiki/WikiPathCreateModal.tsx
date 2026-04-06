import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { fetchWikiSlugSuggestion } from '@/api/wiki'
import {
  parseWikiPathSegment,
  slugifyWikiTitleToSegment,
  validateWikiFullPath,
} from '@/lib/wikiPaths'

export type WikiPathCreateKind = 'section' | 'page'

const INVALID_HINT =
  'Use letters, digits, and hyphens in each part (e.g. guides or guides/my-page). Capitals and spaces are adjusted automatically.'

const SLUG_HINT =
  'One segment, lowercase with hyphens (e.g. my-page). Adjusted automatically from the title until you edit this field.'

const PATH_HINT =
  'Wiki path: one or more segments (e.g. getting-started or guides/chapter-1). Suggested from the title until you edit this field.'

export function WikiPathCreateModal({
  open,
  kind,
  parentPath,
  onClose,
  onConfirm,
}: {
  open: boolean
  kind: WikiPathCreateKind
  /** When set, the new path is `parentPath + '/' +` slug segment (page or section). */
  parentPath?: string
  onClose: () => void
  onConfirm: (
    normalizedPath: string,
    kind: WikiPathCreateKind,
    meta: { displayTitle: string; createAndEdit: boolean }
  ) => Promise<void>
}) {
  const titleId = useId()
  const titleRef = useRef<HTMLInputElement>(null)
  const slugTouchedRef = useRef(false)
  const [title, setTitle] = useState('')
  const [slugInput, setSlugInput] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isSection = kind === 'section'
  const nestedUnder =
    parentPath != null && parentPath.trim() !== ''
      ? parentPath.trim().replace(/^\/+|\/+$/g, '')
      : null

  useEffect(() => {
    if (!open) return
    setTitle('')
    setSlugInput('')
    slugTouchedRef.current = false
    setFieldError(null)
    setSubmitError(null)
    window.requestAnimationFrame(() => {
      titleRef.current?.focus()
    })
  }, [open, kind, nestedUnder])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, busy])

  /** Refine slug with server suggestion (unique among siblings) when title changes and slug not manually edited. */
  useEffect(() => {
    if (!open || slugTouchedRef.current || !title.trim()) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { slug } = await fetchWikiSlugSuggestion(nestedUnder ?? '', title, controller.signal)
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
  }, [title, open, nestedUnder])

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

  const resolvedPathPreview = useMemo(() => {
    const t = title.trim()
    const s = slugInput.trim()
    if (!t && !s) return null
    if (nestedUnder != null) {
      const seg = parseWikiPathSegment(s)
      if (!seg) return null
      return `${nestedUnder}/${seg}`.replace(/\/{2,}/g, '/')
    }
    return validateWikiFullPath(s)
  }, [title, slugInput, nestedUnder])

  const runCreate = async (createAndEdit: boolean) => {
    setSubmitError(null)

    const t = title.trim()
    const s = slugInput.trim()
    if (!t && !s) {
      setFieldError(isSection ? 'Enter a title or path for the new section.' : 'Enter a title or path.')
      return
    }

    let combined: string | null
    if (nestedUnder != null) {
      const seg = parseWikiPathSegment(s)
      if (!seg) {
        setFieldError(SLUG_HINT)
        return
      }
      combined = `${nestedUnder}/${seg}`.replace(/\/{2,}/g, '/')
    } else {
      combined = validateWikiFullPath(s)
      if (!combined) {
        setFieldError(INVALID_HINT)
        return
      }
    }

    const displayTitle = t || combined.split('/').pop() || combined
    setFieldError(null)
    setBusy(true)
    try {
      await onConfirm(combined, kind, { displayTitle, createAndEdit })
      onClose()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (isSection ? 'Could not create section.' : 'Could not create page.')
      setSubmitError(msg)
    } finally {
      setBusy(false)
    }
  }

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault()
    void runCreate(true)
  }

  if (!open) return null

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center bg-black/60 p-4"
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
            {isSection
              ? nestedUnder
                ? `New section under ${nestedUnder}`
                : 'New section'
              : nestedUnder
                ? `New page under ${nestedUnder}`
                : 'New page'}
          </h2>
          <p className="mt-1 text-sm text-foreground/65">
            {nestedUnder
              ? `Path will be ${nestedUnder} plus the slug below. The title starts the page heading.`
              : 'Title and path are independent: the path becomes the URL; the title starts the page heading.'}
          </p>
        </div>
        <form onSubmit={handleFormSubmit} className="px-4 py-4">
          <label htmlFor="wiki-new-title" className="mb-1 block text-xs font-medium text-foreground/70">
            Title
          </label>
          <input
            ref={titleRef}
            id="wiki-new-title"
            type="text"
            autoComplete="off"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={isSection ? 'Getting started' : 'My page'}
            disabled={busy}
            className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 outline-none ring-primary focus:ring-2 disabled:opacity-60"
          />
          <label htmlFor="wiki-new-slug" className="mb-1 block text-xs font-medium text-foreground/70">
            {nestedUnder ? `Slug (under ${nestedUnder})` : 'Path'}
          </label>
          <input
            id="wiki-new-slug"
            type="text"
            autoComplete="off"
            value={slugInput}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder={nestedUnder ? 'my-page' : isSection ? 'getting-started' : 'guides/my-page'}
            disabled={busy}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-foreground/40 outline-none ring-primary focus:ring-2 disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-foreground/55">{nestedUnder ? SLUG_HINT : PATH_HINT}</p>
          <div className="mt-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2 dark:bg-foreground/[0.06]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/55">Path</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">
              {resolvedPathPreview ?? '—'}
            </p>
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
            {isSection ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runCreate(false)}
                  className="min-h-[44px] rounded-lg border border-border bg-background px-4 py-2 font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50 dark:hover:bg-foreground/[0.07]"
                >
                  {busy ? 'Working…' : 'Create section'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Working…' : 'Create and edit'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runCreate(false)}
                  className="min-h-[44px] rounded-lg border border-border bg-background px-4 py-2 font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50 dark:hover:bg-foreground/[0.07]"
                >
                  {busy ? 'Working…' : 'Create page'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Working…' : 'Create and edit'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
