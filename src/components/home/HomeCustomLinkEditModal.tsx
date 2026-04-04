import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { getBasePath } from '@/lib/basePath'
import { faviconUrlForHref } from '@/lib/linkFavicon'
import { randomUuid } from '@/lib/randomUuid'
import type { HomeCustomLink } from '@/types/homePage'

interface HomeCustomLinkEditModalProps {
  /** `null` = create new link */
  initial: HomeCustomLink | null
  onSave: (link: HomeCustomLink) => void
  onClose: () => void
}

export function HomeCustomLinkEditModal({ initial, onSave, onClose }: HomeCustomLinkEditModalProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [href, setHref] = useState(initial?.href ?? '')
  const [allowedRoleSlugs, setAllowedRoleSlugs] = useState<string[]>(() =>
    initial?.allowedRoleSlugs?.length ? [...initial.allowedRoleSlugs] : []
  )
  const [roleOptions, setRoleOptions] = useState<{ slug: string; label: string }[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setTitle(initial?.title ?? '')
    setDescription(initial?.description ?? '')
    setHref(initial?.href ?? '')
    setAllowedRoleSlugs(initial?.allowedRoleSlugs?.length ? [...initial.allowedRoleSlugs] : [])
  }, [initial])

  useEffect(() => {
    api
      .get<Array<{ slug: string; label: string }>>('/home/role-options')
      .then((r) => setRoleOptions(r.data))
      .catch(() => setRoleOptions([]))
  }, [])

  const faviconPreview = useMemo(() => faviconUrlForHref(href.trim()), [href])
  const isInAppPath = href.trim().startsWith('/') && !href.trim().startsWith('//')
  const appIconPreview = `${getBasePath()}/icon.png`

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
    onSave({
      id: initial?.id ?? randomUuid(),
      title: t,
      description: description.trim(),
      href: h,
      ...(sortedRoles.length > 0 ? { allowedRoleSlugs: sortedRoles } : {}),
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <form
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-lg font-semibold text-foreground">
            {initial ? 'Edit link' : 'Add link'}
          </h3>
          <p className="mt-1 text-sm text-foreground/70">
            In-app paths start with <code className="rounded bg-background px-1">/</code> (e.g.{' '}
            <code className="rounded bg-background px-1">/testing</code>), or use a full URL.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
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
              placeholder="https://… or /testing"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
              required
            />
            {faviconPreview ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-background/50 px-2 py-2">
                <img
                  src={faviconPreview}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded border border-border bg-background object-contain"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
                <p className="text-xs leading-snug text-foreground/65">
                  Card shows this site&apos;s favicon (looked up from the URL host).
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
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || !href.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {initial ? 'Save link' : 'Add link'}
          </button>
        </div>
      </form>
    </div>
  )
}
