import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '@/api/client'
import { publicAsset } from '@/lib/basePath'
import { externalFaviconCandidateUrls } from '@/lib/linkFavicon'
import { randomUuid } from '@/lib/randomUuid'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import type { HomeCustomLink } from '@/types/homePage'

interface HomeCustomLinkEditModalProps {
  /** `null` = create new link */
  initial: HomeCustomLink | null
  onSave: (link: HomeCustomLink) => void
  onClose: () => void
  /** When provided, category dropdown is shown for grouping on home / links directory. */
  linkCategories?: { id: string; title: string }[]
  /** Same value as “Max links on home” on the manage links page. */
  maxLinksOnHome: number
  /** Free slots for turning “show on home” on (current link excluded when editing). */
  homeShowOnRemainingSlots: number
}

export function HomeCustomLinkEditModal({
  initial,
  onSave,
  onClose,
  linkCategories,
  maxLinksOnHome,
  homeShowOnRemainingSlots,
}: HomeCustomLinkEditModalProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [href, setHref] = useState(initial?.href ?? '')
  /** Only used for external favicon preview — updated on blur so we do not hit the favicon service while typing. */
  const [hrefCommittedForFavicon, setHrefCommittedForFavicon] = useState(initial?.href ?? '')
  const [allowedRoleSlugs, setAllowedRoleSlugs] = useState<string[]>(() =>
    initial?.allowedRoleSlugs?.length ? [...initial.allowedRoleSlugs] : []
  )
  const [categoryId, setCategoryId] = useState(() => initial?.categoryId?.trim() ?? '')
  const [showOnHome, setShowOnHome] = useState(() => initial?.showOnHome !== false)
  const [roleOptions, setRoleOptions] = useState<{ slug: string; label: string }[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const h = initial?.href ?? ''
    setTitle(initial?.title ?? '')
    setDescription(initial?.description ?? '')
    setHref(h)
    setHrefCommittedForFavicon(h)
    setAllowedRoleSlugs(initial?.allowedRoleSlugs?.length ? [...initial.allowedRoleSlugs] : [])
    setCategoryId(initial?.categoryId?.trim() ?? '')
    setShowOnHome(initial?.showOnHome !== false)
  }, [initial])

  useEffect(() => {
    api
      .get<Array<{ slug: string; label: string }>>('/home/role-options')
      .then((r) => setRoleOptions(r.data))
      .catch(() => setRoleOptions([]))
  }, [])

  const faviconCandidates = useMemo(
    () => externalFaviconCandidateUrls(hrefCommittedForFavicon.trim()),
    [hrefCommittedForFavicon]
  )
  const [faviconPreviewIdx, setFaviconPreviewIdx] = useState(0)
  useEffect(() => {
    setFaviconPreviewIdx(0)
  }, [hrefCommittedForFavicon])
  const isInAppPath = href.trim().startsWith('/') && !href.trim().startsWith('//')
  const appIconPreview = publicAsset('icon.png')

  const toggleRole = (slug: string) => {
    setAllowedRoleSlugs((prev) => {
      const has = prev.includes(slug)
      if (has) return prev.filter((s) => s !== slug)
      return [...prev, slug]
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    const h = href.trim()
    if (!t || !h) return
    const sortedRoles = [...new Set(allowedRoleSlugs)].sort()
    const payload: HomeCustomLink = {
      id: initial?.id ?? randomUuid(),
      title: t,
      description: description.trim(),
      href: h,
      ...(sortedRoles.length > 0 ? { allowedRoleSlugs: sortedRoles } : {}),
    }
    if (linkCategories && linkCategories.length > 0) {
      payload.categoryId = categoryId.trim() ? categoryId.trim() : null
    }
    payload.showOnHome = showOnHome
    onSave(payload)
    onClose()
  }

  /** Portal escapes `main`/transform stacking so the backdrop reliably blocks clicks to router Links below. */
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center overflow-hidden bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        // Only backdrop closes nothing here; absorb events so nothing behind receives clicks.
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
      <form
        className="flex min-h-0 w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg max-h-[min(90vh,calc(100vh-2rem))]"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="shrink-0 border-b border-border bg-card px-5 py-4">
          <h3 className="text-lg font-semibold text-foreground">
            {initial ? 'Edit link' : 'Add link'}
          </h3>
          <p className="mt-1 text-sm text-foreground/70">
            In-app paths start with <code className="rounded bg-background px-1">/</code> (e.g.{' '}
            <code className="rounded bg-background px-1">/testing</code>), or use a full URL.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="link-title">
              Title
            </label>
            <input
              id="link-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="link-desc">
              Description
            </label>
            <textarea
              id="link-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="link-href">
              URL or path
            </label>
            <input
              id="link-href"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onBlur={(e) => setHrefCommittedForFavicon(e.currentTarget.value)}
              placeholder="https://… or /testing"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
              required
            />
            {faviconCandidates.length > 0 ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-background/50 px-2 py-2">
                <img
                  key={`${faviconCandidates[faviconPreviewIdx]}-${faviconPreviewIdx}`}
                  src={faviconCandidates[faviconPreviewIdx]}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded border border-border bg-background object-contain"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setFaviconPreviewIdx((idx) =>
                      idx < faviconCandidates.length - 1 ? idx + 1 : idx
                    )
                  }
                />
                <p className="text-xs leading-snug text-foreground/65">
                  Card shows this site&apos;s favicon (from the URL if available).
                </p>
              </div>
            ) : isInAppPath ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-background/50 px-2 py-2">
                <img
                  src={appIconPreview}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded border border-border bg-background object-contain"
                  loading="lazy"
                />
                <p className="text-xs leading-snug text-foreground/65">
                  In-app paths use this app&apos;s icon on the card.
                </p>
              </div>
            ) : href.trim().startsWith('mailto:') ? (
              <p className="mt-2 text-xs text-foreground/60">Email links use a mail icon on the card.</p>
            ) : null}
          </div>
          {linkCategories && linkCategories.length > 0 ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="link-category">
                Category
              </label>
              <select
                id="link-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">OTHER</option>
                {linkCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-foreground/60">Groups this link under a heading on home and the links page.</p>
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-3 py-3">
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">Show on home hub</span>
              <span className="mt-1 block text-xs leading-relaxed text-foreground/65">
                When off, this link only appears on the full <strong className="font-medium">Links</strong> page. At most{' '}
                <strong className="font-medium">{maxLinksOnHome}</strong> links can be on the hub;{' '}
                {homeShowOnRemainingSlots <= 0 && !showOnHome ? (
                  <span className="text-amber-700 dark:text-amber-300">no slots left — turn another link off or raise Max links on home.</span>
                ) : (
                  <>
                    <strong className="font-medium">{Math.max(0, homeShowOnRemainingSlots)}</strong> slot
                    {homeShowOnRemainingSlots === 1 ? '' : 's'} left for enabling another link.
                  </>
                )}
              </span>
            </div>
            <ToggleSwitch
              checked={showOnHome}
              onCheckedChange={(on) => {
                if (on && !showOnHome && homeShowOnRemainingSlots <= 0) return
                setShowOnHome(on)
              }}
              aria-label="Show link on home hub"
              size="md"
              disabled={!showOnHome && homeShowOnRemainingSlots <= 0}
              title={
                !showOnHome && homeShowOnRemainingSlots <= 0
                  ? `Home hub is limited to ${maxLinksOnHome} links`
                  : undefined
              }
              className="mt-0.5 shrink-0"
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-foreground">Visible to roles</span>
            <p className="mb-2 text-xs text-foreground/60">
              Choose which user roles see this link under <strong>Links</strong>. Leave none selected to show it
              to everyone who can open Home.
            </p>
            {initial?.requiredPermission && !initial?.allowedRoleSlugs?.length ? (
              <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-100">
                This link still uses legacy visibility by permission ({initial.requiredPermission}). Saving will
                switch to role-based visibility only.
              </p>
            ) : null}
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
                        checked={allowedRoleSlugs.includes(r.slug)}
                        onChange={() => toggleRole(r.slug)}
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
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {initial ? 'Save link' : 'Add link'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
