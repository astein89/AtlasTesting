import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { api, isAbortLikeError } from '@/api/client'
import { useAbortableEffect } from '@/hooks/useAbortableEffect'
import { HomeLinkCard } from '@/components/home/HomeLinkCard'
import {
  DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT,
  DEFAULT_HOME_HUB_LINK_COLUMNS,
  clampHomeHubLinkColumns,
  filterVisibleCustomLinks,
  groupVisibleLinksForDisplay,
  hubLinkCardsGridStyle,
} from '@/lib/homeLinkVisibility'
import { useAuthStore } from '@/store/authStore'
import type { HomeCustomLink, HomePageConfig } from '@/types/homePage'

const HomeLinksManagerPanel = lazy(() =>
  import('./HomeLinksManagerPage').then((m) => ({ default: m.HomeLinksManagerPanel }))
)

function userRoleSlugs(user: ReturnType<typeof useAuthStore.getState>['user']): string[] {
  if (!user) return []
  if (user.roles && user.roles.length > 0) return user.roles
  if (user.role?.trim()) return [user.role.trim()]
  return []
}

export function HomeLinksPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const user = useAuthStore((s) => s.user)
  const canManageLinks = useMemo(() => hasPermission('links.edit'), [hasPermission])
  const [searchParams, setSearchParams] = useSearchParams()
  const [config, setConfig] = useState<HomePageConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const { data } = await api.get<HomePageConfig>('/home', { signal })
      setConfig({
        introMarkdown: typeof data.introMarkdown === 'string' ? data.introMarkdown : '',
        customLinks: Array.isArray(data.customLinks) ? data.customLinks : [],
        linkCategories: Array.isArray(data.linkCategories) ? data.linkCategories : [],
        customLinksInitialVisibleCount:
          typeof data.customLinksInitialVisibleCount === 'number'
            ? data.customLinksInitialVisibleCount
            : DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT,
        homeHubLinkColumns: clampHomeHubLinkColumns(
          data.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS
        ),
        linksPageLinkColumns: clampHomeHubLinkColumns(
          data.linksPageLinkColumns ?? data.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS
        ),
      })
    } catch (e) {
      if (isAbortLikeError(e)) return
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useAbortableEffect((signal) => load(signal), [load])

  const roleSlugs = userRoleSlugs(user)
  const visibleLinks = useMemo(() => {
    if (!config) return []
    return filterVisibleCustomLinks(config.customLinks, hasPermission, roleSlugs)
  }, [config, hasPermission, roleSlugs])

  const grouped = useMemo(() => {
    const cats = config?.linkCategories ?? []
    return groupVisibleLinksForDisplay(visibleLinks, cats)
  }, [visibleLinks, config?.linkCategories])

  const linkColumns = useMemo(
    () =>
      config
        ? clampHomeHubLinkColumns(
            config.linksPageLinkColumns ?? config.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS
          )
        : 1,
    [config?.linksPageLinkColumns, config?.homeHubLinkColumns]
  )

  const linksSectionGridStyle = useMemo(
    () => hubLinkCardsGridStyle(linkColumns),
    [linkColumns]
  )

  /** Match home hub width when single-column (HomePage links column uses max-w-md). */
  const pageShellClass =
    linkColumns <= 1 ? 'mx-auto max-w-md px-4 py-8 sm:py-12' : 'mx-auto max-w-5xl px-4 py-8 sm:py-12'

  const stripManageParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('manage')
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  const closeManage = useCallback(() => {
    setManageOpen(false)
    stripManageParam()
  }, [stripManageParam])

  useEffect(() => {
    if (searchParams.get('manage') !== '1') return
    if (!canManageLinks) {
      stripManageParam()
      setManageOpen(false)
      return
    }
    setManageOpen(true)
  }, [searchParams, canManageLinks, stripManageParam])

  useEffect(() => {
    if (!manageOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [manageOpen])

  return (
    <div className={pageShellClass}>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Links</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link to="/" className="font-medium text-primary hover:underline">
            ← Back to home
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : visibleLinks.length === 0 ? (
        <p className="text-sm text-foreground/70">
          No links are available for your account. Sign in with a role that can see curated links, or ask an
          administrator if something is missing.
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {grouped.map((section, i) => (
            <section key={`links-section-${i}`} aria-label={section.heading ?? 'Links'}>
              {section.heading ? (
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/50">
                  {section.heading}
                </h2>
              ) : null}
              <ul
                className={linkColumns <= 1 ? 'flex flex-col gap-3' : 'min-w-0 w-full'}
                style={linksSectionGridStyle}
              >
                {section.links.map((link: HomeCustomLink) => (
                  <li key={link.id} className="flex min-w-0">
                    <HomeLinkCard
                      title={link.title}
                      description={link.description}
                      href={link.href}
                      showUrl
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {manageOpen && canManageLinks
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-stretch justify-center sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="manage-links-heading"
            >
              <div className="absolute inset-0 bg-black/60" aria-hidden />
              <div className="relative z-10 flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-background shadow-2xl sm:h-auto sm:max-h-[min(100dvh-2rem,56rem)] sm:rounded-xl sm:border sm:border-border">
                <Suspense
                  fallback={
                    <div className="flex flex-1 items-center justify-center p-8 text-sm text-foreground/60">
                      Loading editor…
                    </div>
                  }
                >
                  <HomeLinksManagerPanel onClose={closeManage} onSaved={() => void load()} />
                </Suspense>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
