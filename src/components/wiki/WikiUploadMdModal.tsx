import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchWikiPages,
  fetchWikiSlugSuggestion,
  saveWikiPage,
  WIKI_MAX_MARKDOWN_CHARS,
} from '@/api/wiki'
import {
  parseWikiPathSegment,
  slugifyWikiTitleToSegment,
  validateWikiFullPath,
  wikiNestParentPathOptions,
} from '@/lib/wikiPaths'

const INVALID_HINT =
  'Use letters, digits, and hyphens in each part (e.g. guides or guides/my-page). Capitals and spaces are adjusted automatically.'

const SLUG_HINT =
  'One segment, lowercase with hyphens (e.g. my-page). Adjusted automatically from the file name until you edit this field.'

const PATH_HINT =
  'Wiki path: one or more segments (e.g. getting-started or guides/chapter-1). Suggested from the file name until you edit this field.'

function basenameNoExtension(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name
  return base.replace(/\.(md|markdown)$/i, '').trim() || 'page'
}

export function WikiUploadMdModal({
  open,
  parentPath: initialParentPath,
  onClose,
  onUploaded,
}: {
  open: boolean
  /** Pre-select parent folder (empty = wiki root). */
  parentPath?: string
  onClose: () => void
  onUploaded: (path: string, meta: { openEdit: boolean }) => void | Promise<void>
}) {
  const titleId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const slugTouchedRef = useRef(false)
  const [pages, setPages] = useState<{ path: string }[]>([])
  const [parentSelect, setParentSelect] = useState('')
  const [slugInput, setSlugInput] = useState('')
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [pickedLabel, setPickedLabel] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const nestedUnder =
    parentSelect.trim() !== '' ? parentSelect.trim().replace(/^\/+|\/+$/g, '') : null

  useEffect(() => {
    if (!open) return
    slugTouchedRef.current = false
    setSlugInput('')
    setMarkdown(null)
    setPickedLabel(null)
    setFieldError(null)
    setSubmitError(null)
    const p =
      initialParentPath != null && initialParentPath.trim() !== ''
        ? initialParentPath.trim().replace(/^\/+|\/+$/g, '')
        : ''
    setParentSelect(p)
    void fetchWikiPages()
      .then((list) => setPages(Array.isArray(list) ? list : []))
      .catch(() => setPages([]))
    window.requestAnimationFrame(() => {
      fileInputRef.current?.focus()
    })
  }, [open, initialParentPath])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, busy])

  /** Unique slug among siblings when title (from file name) changes and slug not manually edited. */
  useEffect(() => {
    if (!open || slugTouchedRef.current || markdown == null) return
    const base = basenameNoExtension(pickedLabel ?? 'page')
    if (!base.trim()) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { slug } = await fetchWikiSlugSuggestion(nestedUnder ?? '', base, controller.signal)
          if (!slugTouchedRef.current) setSlugInput(slug)
        } catch (e: unknown) {
          if (controller.signal.aborted) return
          if (!slugTouchedRef.current) setSlugInput(slugifyWikiTitleToSegment(base))
        }
      })()
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [markdown, pickedLabel, open, nestedUnder])

  const parentOptions = useMemo(() => {
    const base = wikiNestParentPathOptions(pages)
    const p = parentSelect.trim()
    if (!p || base.includes(p)) return base
    const merged = [...base, p]
    merged.sort((a, b) => {
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b)
    })
    return merged
  }, [pages, parentSelect])

  const resolvedPathPreview = useMemo(() => {
    const s = slugInput.trim()
    if (!s) return null
    if (nestedUnder != null) {
      const seg = parseWikiPathSegment(s)
      if (!seg) return null
      return `${nestedUnder}/${seg}`.replace(/\/{2,}/g, '/')
    }
    return validateWikiFullPath(s)
  }, [slugInput, nestedUnder])

  const readFile = (file: File) => {
    setFieldError(null)
    setSubmitError(null)
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setFieldError('Choose a .md or .markdown file.')
      setMarkdown(null)
      setPickedLabel(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (text.length > WIKI_MAX_MARKDOWN_CHARS) {
        setFieldError(`File is too large (max ${WIKI_MAX_MARKDOWN_CHARS.toLocaleString()} characters).`)
        setMarkdown(null)
        setPickedLabel(null)
        return
      }
      slugTouchedRef.current = false
      setMarkdown(text)
      setPickedLabel(file.name)
    }
    reader.onerror = () => {
      setFieldError('Could not read that file.')
      setMarkdown(null)
      setPickedLabel(null)
    }
    reader.readAsText(file, 'UTF-8')
  }

  const runUpload = async (openEdit: boolean) => {
    setSubmitError(null)
    if (markdown == null || markdown === '') {
      setFieldError('Choose a markdown file to upload.')
      return
    }
    const s = slugInput.trim()
    if (!s) {
      setFieldError('Enter a wiki path or slug.')
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

    setFieldError(null)
    setBusy(true)
    try {
      await saveWikiPage(combined, markdown)
      await onUploaded(combined, { openEdit })
      onClose()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not upload page.'
      setSubmitError(msg)
    } finally {
      setBusy(false)
    }
  }

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault()
    void runUpload(true)
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
            Upload markdown file
          </h2>
          <p className="mt-1 text-sm text-foreground/65">
            Creates a wiki page from a local .md file. Path rules match new page: pick a parent folder or type a full
            path at wiki root.
          </p>
        </div>
        <form onSubmit={handleFormSubmit} className="px-4 py-4">
          <label htmlFor="wiki-upload-file" className="mb-1 block text-xs font-medium text-foreground/70">
            File
          </label>
          <input
            ref={fileInputRef}
            id="wiki-upload-file"
            type="file"
            accept=".md,.markdown,text/markdown"
            disabled={busy}
            className="mb-3 block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-foreground/[0.04] disabled:opacity-60"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readFile(f)
            }}
          />
          {pickedLabel ? (
            <p className="mb-3 text-xs text-foreground/55">
              Selected: <span className="font-mono text-foreground/80">{pickedLabel}</span>
            </p>
          ) : null}

          <label htmlFor="wiki-upload-parent" className="mb-1 block text-xs font-medium text-foreground/70">
            Parent folder
          </label>
          <select
            id="wiki-upload-parent"
            disabled={busy}
            value={parentSelect}
            onChange={(e) => {
              setParentSelect(e.target.value)
              setFieldError(null)
              setSubmitError(null)
            }}
            className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-primary focus:ring-2 disabled:opacity-60"
          >
            {parentOptions.map((p) => (
              <option key={p || 'root'} value={p}>
                {p === '' ? '(wiki root)' : p}
              </option>
            ))}
          </select>

          <label htmlFor="wiki-upload-slug" className="mb-1 block text-xs font-medium text-foreground/70">
            {nestedUnder != null ? `Slug (under ${nestedUnder})` : 'Path'}
          </label>
          <input
            id="wiki-upload-slug"
            type="text"
            autoComplete="off"
            value={slugInput}
            onChange={(e) => {
              slugTouchedRef.current = true
              setSlugInput(e.target.value)
              setFieldError(null)
              setSubmitError(null)
            }}
            placeholder={nestedUnder != null ? 'my-page' : 'guides/my-page'}
            disabled={busy}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-foreground/40 outline-none ring-primary focus:ring-2 disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-foreground/55">{nestedUnder != null ? SLUG_HINT : PATH_HINT}</p>

          <div className="mt-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2 dark:bg-foreground/[0.06]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/55">Path</p>
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
              type="button"
              disabled={busy || markdown == null}
              onClick={() => void runUpload(false)}
              className="min-h-[44px] rounded-lg border border-border bg-background px-4 py-2 font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50 dark:hover:bg-foreground/[0.07]"
            >
              {busy ? 'Working…' : 'Upload'}
            </button>
            <button
              type="submit"
              disabled={busy || markdown == null}
              className="min-h-[44px] rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Upload and edit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
