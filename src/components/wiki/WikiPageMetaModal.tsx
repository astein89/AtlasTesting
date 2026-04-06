import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import type { WikiPageKind } from '@/api/wiki'
import { parseWikiPathSegment, validateWikiFullPath } from '@/lib/wikiPaths'

const SLUG_HINT =
  'URL segment: lowercase letters, digits, and hyphens. Normalized when you leave the field.'

const WIKI_META_NEW_SECTION = '__new_section__'

function nestOptionLabel(path: string): string {
  if (!path) return 'Wiki root'
  return path
}

export function WikiPageMetaModal({
  open,
  onClose,
  /** If set, shows Cancel and discards in-modal edits without saving. */
  onCancel,
  /** If set, Escape closes without calling `onClose` (e.g. discard). Omit to use `onClose` on Escape. */
  onEscape,
  primaryActionLabel = 'Save changes',
  wikiPageKind,
  pageDisplayName,
  onPageDisplayNameChange,
  nestParentOptions,
  onRequestNewSection,
  pathParent,
  onPathParentChange,
  pathSlug,
  onPathSlugChange,
  onPathSlugBlur,
  pathValid,
  resolvedPathPreview,
  roleOptions,
  viewRoleSlugs,
  onToggleRole,
  /** Sections only: list below section body on wiki view. */
  showSectionPages = true,
  onShowSectionPagesChange,
  disabled,
}: {
  open: boolean
  onClose: () => void
  onCancel?: () => void
  onEscape?: () => void
  primaryActionLabel?: string
  wikiPageKind: WikiPageKind
  pageDisplayName: string
  onPageDisplayNameChange: (value: string) => void
  nestParentOptions: string[]
  onRequestNewSection: () => void
  pathParent: string
  onPathParentChange: (value: string) => void
  pathSlug: string
  onPathSlugChange: (value: string) => void
  onPathSlugBlur: () => void
  pathValid: boolean
  resolvedPathPreview: string | null
  roleOptions: Array<{ slug: string; label: string }>
  viewRoleSlugs: string[]
  onToggleRole: (slug: string) => void
  showSectionPages?: boolean
  onShowSectionPagesChange?: (value: boolean) => void
  disabled: boolean
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || disabled) return
      if (onEscape) onEscape()
      else void onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, onEscape, disabled])

  if (!open) return null

  const isSection = wikiPageKind === 'section'
  const pageOrSection = isSection ? 'section' : 'page'

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="mx-auto flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {isSection ? 'Section settings' : 'Page settings'}
          </h2>
          <p className="mt-1 text-sm text-foreground/65">
            Path, title, and who can browse this {pageOrSection} (editors with{' '}
            <span className="font-mono text-foreground/80">wiki.edit</span> can always open the editor).
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <label className="mb-3 block text-sm">
            <span className="text-foreground/70">{isSection ? 'Section name' : 'Page name'}</span>
            <p className="mb-1 text-xs text-foreground/55">
              Shown as the main heading and in the wiki. Updates the first{' '}
              <span className="font-mono">#</span> line when you save.
            </p>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none ring-primary focus:ring-2"
              value={pageDisplayName}
              placeholder="e.g. Getting started"
              disabled={disabled}
              onChange={(e) => onPageDisplayNameChange(e.target.value)}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-foreground/70">Folder</span>
              <select
                className="mt-1 min-h-[44px] w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none ring-primary focus:ring-2 disabled:opacity-60"
                value={pathParent}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === WIKI_META_NEW_SECTION) {
                    onRequestNewSection()
                    return
                  }
                  onPathParentChange(v)
                }}
              >
                {nestParentOptions.map((p) => (
                  <option key={p || '__root__'} value={p}>
                    {nestOptionLabel(p)}
                  </option>
                ))}
                <option value={WIKI_META_NEW_SECTION}>+ Add new section…</option>
              </select>
              <p className="mt-1 text-xs text-foreground/55">
                New section creates a folder with an index page, then places this {pageOrSection} under it.
              </p>
            </label>
            <label className="block text-sm">
              <span className="text-foreground/70">URL slug</span>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none ring-primary focus:ring-2"
                value={pathSlug}
                placeholder="e.g. my-page"
                disabled={disabled}
                onChange={(e) => onPathSlugChange(e.target.value)}
                onBlur={() => {
                  onPathSlugBlur()
                }}
              />
              <p className="mt-1 text-xs text-foreground/55">{SLUG_HINT}</p>
            </label>
          </div>

          {resolvedPathPreview != null ? (
            <p className="mt-2 break-all font-mono text-xs text-foreground/70">
              Path: <span className="text-foreground">{resolvedPathPreview}</span>
            </p>
          ) : null}
          {!pathValid ? (
            <p className="mt-2 text-xs text-destructive">Fix the folder or slug to save.</p>
          ) : null}

          <div className="mt-4 border-t border-border pt-4">
            <span className="mb-1 block text-sm text-foreground/70">
              Who can view this {pageOrSection}
            </span>
            <p className="mb-2 text-xs text-foreground/60">
              Users need at least one of the selected roles to see this {pageOrSection} in the wiki. Leave
              none selected to allow everyone who can open the wiki.
            </p>
            <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-3">
              {roleOptions.length === 0 ? (
                <li className="text-sm text-foreground/60">Loading roles…</li>
              ) : (
                roleOptions.map((r) => (
                  <li key={r.slug}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded border-border"
                        checked={viewRoleSlugs.includes(r.slug)}
                        disabled={disabled}
                        onChange={() => onToggleRole(r.slug)}
                      />
                      <span>
                        {r.label} <span className="text-foreground/50">({r.slug})</span>
                      </span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          </div>

          {isSection && onShowSectionPagesChange ? (
            <div className="mt-4 border-t border-border pt-4">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-border"
                  checked={showSectionPages}
                  disabled={disabled}
                  onChange={(e) => onShowSectionPagesChange(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Show “Pages in this section” on the wiki view</span>
                  <p className="mt-1 text-xs text-foreground/60">
                    When off, readers still see child pages in the sidebar but not the list under this
                    section&apos;s content.
                  </p>
                </span>
              </label>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
          {onCancel ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className="min-h-[44px] w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-foreground/[0.04] disabled:opacity-50 sm:mr-auto sm:w-auto dark:hover:bg-foreground/[0.07]"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onClose()}
            className="min-h-[44px] w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:w-auto"
          >
            {primaryActionLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}

/** Normalizes folder input on blur (used by parent for consistency). */
export function normalizeWikiPathParentInput(raw: string): string {
  const p = raw.trim().replace(/^\/+|\/+$/g, '')
  if (!p) return ''
  return validateWikiFullPath(p) ?? raw
}

/** Normalizes slug on blur. */
export function normalizeWikiPathSlugInput(raw: string): string {
  const seg = parseWikiPathSegment(raw)
  return seg ?? raw
}
