import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, isAbortLikeError } from '@/api/client'
import { useAbortableEffect } from '@/hooks/useAbortableEffect'
import { appModules, getModuleRequiredPermission } from '@/config/modules'
import {
  DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT,
  DEFAULT_HOME_HUB_LINK_COLUMNS,
  clampCustomLinksOnHomeMax,
  clampHomeHubLinkColumns,
  filterVisibleCustomLinks,
  hubLinkCardsGridStyle,
  linkShowsOnHomeHub,
} from '@/lib/homeLinkVisibility'
import { mergeHomeModuleOrder, sortHomeModules } from '@/lib/homeModuleOrder'
import { HomeIntroMarkdown } from '@/components/home/HomeIntroMarkdown'
import { HomeLinkCard } from '@/components/home/HomeLinkCard'
import { HomePageEditModal } from '@/components/home/HomePageEditModal'
import { publicAsset } from '@/lib/basePath'
import { applyIconsFromHomeBrandingPayload } from '@/lib/homeBrandingIcons'
import { uploadsUrl } from '@/lib/uploadsUrl'
import { WELCOME_LOGO_DEFAULT_REM, clampWelcomeLogoMaxRem } from '@/lib/welcomeLogoSize'
import { useAuthStore } from '@/store/authStore'
import { useHomePageEditStore } from '@/store/homePageEditStore'
import type { HomeCustomLink, HomePageConfig } from '@/types/homePage'

/** Shown only if `/api/home` fails; normal default is `content/home-intro.md` on the server. */
const FALLBACK_HOME: HomePageConfig = {
  introMarkdown:
    '# Welcome to **DC Automation**\n\nUse the modules to open **Test Plans** or **Locations**. Sign in when needed.\n\nIf this message persists, the home configuration could not be loaded—check the API and network.',
  customLinks: [],
  linkCategories: [],
  modulesHiddenFromHome: [],
  showWelcomeLogo: false,
  welcomeLogoMaxRem: WELCOME_LOGO_DEFAULT_REM,
  welcomeLogoPath: null,
  siteFaviconPath: null,
  homeBrandingRevision: 0,
  customLinksInitialVisibleCount: DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT,
  homeHubLinkColumns: DEFAULT_HOME_HUB_LINK_COLUMNS,
  homeHubColumnCategoryIds: [],
  homeHubCategoryColumnMap: {},
  homeHubOtherLinksColumn: null,
  linksPageLinkColumns: DEFAULT_HOME_HUB_LINK_COLUMNS,
}

const knownModuleIdSet = new Set(appModules.map((m) => m.id))

function normalizeModulesHiddenFromHomeApi(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of ids) {
    if (typeof x !== 'string') continue
    const id = x.trim()
    if (!knownModuleIdSet.has(id) || seen.has(id)) continue
    out.push(id)
    seen.add(id)
  }
  return out
}

function userRoleSlugs(user: ReturnType<typeof useAuthStore.getState>['user']): string[] {
  if (!user) return []
  if (user.roles && user.roles.length > 0) return user.roles
  if (user.role?.trim()) return [user.role.trim()]
  return []
}

export function HomePage() {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const user = useAuthStore((s) => s.user)
  const [config, setConfig] = useState<HomePageConfig>(FALLBACK_HOME)
  const [loading, setLoading] = useState(true)
  const editOpen = useHomePageEditStore((s) => s.editorOpen)
  const setEditOpen = useHomePageEditStore((s) => s.setEditorOpen)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const { data } = await api.get<HomePageConfig & { introSubtitle?: string; introTitle?: string }>(
        '/home',
        { signal }
      )
      let introMarkdown =
        typeof data.introMarkdown === 'string' && data.introMarkdown.trim()
          ? data.introMarkdown
          : ''
      if (!introMarkdown && typeof data.introSubtitle === 'string') introMarkdown = data.introSubtitle
      if (!introMarkdown.trim()) introMarkdown = FALLBACK_HOME.introMarkdown
      const brandingRev =
        typeof data.homeBrandingRevision === 'number' ? data.homeBrandingRevision : 0
      const welcomePath =
        typeof data.welcomeLogoPath === 'string' && data.welcomeLogoPath.trim()
          ? data.welcomeLogoPath.trim()
          : null
      const faviconPath =
        typeof data.siteFaviconPath === 'string' && data.siteFaviconPath.trim()
          ? data.siteFaviconPath.trim()
          : null
      setConfig({
        introMarkdown,
        customLinks: Array.isArray(data.customLinks) ? data.customLinks : [],
        linkCategories: Array.isArray(data.linkCategories) ? data.linkCategories : [],
        moduleOrder: mergeHomeModuleOrder(
          Array.isArray(data.moduleOrder) ? (data.moduleOrder as string[]) : undefined
        ),
        modulesHiddenFromHome: normalizeModulesHiddenFromHomeApi(data.modulesHiddenFromHome),
        showWelcomeLogo: data.showWelcomeLogo === true,
        welcomeLogoMaxRem: clampWelcomeLogoMaxRem(data.welcomeLogoMaxRem),
        welcomeLogoPath: welcomePath,
        siteFaviconPath: faviconPath,
        homeBrandingRevision: brandingRev,
        customLinksInitialVisibleCount:
          typeof data.customLinksInitialVisibleCount === 'number'
            ? data.customLinksInitialVisibleCount
            : DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT,
        homeHubLinkColumns: clampHomeHubLinkColumns(data.homeHubLinkColumns),
        homeHubColumnCategoryIds: Array.isArray(data.homeHubColumnCategoryIds)
          ? data.homeHubColumnCategoryIds
          : [],
        homeHubCategoryColumnMap:
          data.homeHubCategoryColumnMap && typeof data.homeHubCategoryColumnMap === 'object' && !Array.isArray(data.homeHubCategoryColumnMap)
            ? (data.homeHubCategoryColumnMap as Record<string, number>)
            : {},
        homeHubOtherLinksColumn:
          typeof data.homeHubOtherLinksColumn === 'number' && Number.isFinite(data.homeHubOtherLinksColumn)
            ? Math.floor(data.homeHubOtherLinksColumn)
            : data.homeHubOtherLinksColumn === null
              ? null
              : null,
        linksPageLinkColumns: clampHomeHubLinkColumns(
          data.linksPageLinkColumns ?? data.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS
        ),
      })
      applyIconsFromHomeBrandingPayload({
        siteFaviconPath: faviconPath,
        homeBrandingRevision: brandingRev,
      })
    } catch (e) {
      if (isAbortLikeError(e)) return
      setConfig(FALLBACK_HOME)
    } finally {
      setLoading(false)
    }
  }, [])

  useAbortableEffect((signal) => load(signal), [load])

  useEffect(
    () => () => {
      setEditOpen(false)
    },
    [setEditOpen]
  )

  const hiddenFromHome = useMemo(
    () => new Set(config.modulesHiddenFromHome ?? []),
    [config.modulesHiddenFromHome]
  )
  const visibleModules = sortHomeModules(
    appModules.filter(
      (m) => hasPermission(getModuleRequiredPermission(m)) && !hiddenFromHome.has(m.id)
    ),
    config.moduleOrder
  )
  const hasVisibleModules = visibleModules.length > 0

  const roleSlugs = userRoleSlugs(user)
  const visibleCustomLinks = filterVisibleCustomLinks(config.customLinks, hasPermission, roleSlugs)
  const hubLinksFlat = useMemo(() => {
    const filtered = visibleCustomLinks.filter(linkShowsOnHomeHub)
    return [...filtered].sort(
      (a, b) =>
        (a.homeSortOrder ?? 0) - (b.homeSortOrder ?? 0) || a.id.localeCompare(b.id)
    )
  }, [visibleCustomLinks])
  /** Defensive cap for legacy rows; saves clamp on-home toggles to this max. */
  const hubCardLimit = clampCustomLinksOnHomeMax(
    config.customLinksInitialVisibleCount ?? DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT
  )
  const hubLinkColumns = useMemo(
    () => clampHomeHubLinkColumns(config.homeHubLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS),
    [config.homeHubLinkColumns]
  )
  const hubLinksMulticolStyle = useMemo(
    () => hubLinkCardsGridStyle(hubLinkColumns),
    [hubLinkColumns]
  )
  /** Flat list in global link order — cards flow across hub columns (no per-category column routing). */
  const hubSlice = useMemo(() => hubLinksFlat.slice(0, hubCardLimit), [hubLinksFlat, hubCardLimit])
  /** Full directory on `/links` when some links are off the hub, or when more on-home links exist than the hub limit. */
  const showLinksDirectoryCard =
    visibleCustomLinks.some((l) => l.showOnHome === false) || hubLinksFlat.length > hubCardLimit
  const showHubLinkCards = hubSlice.length > 0
  const showLinksColumn = showHubLinkCards || showLinksDirectoryCard
  const showModulesAndLinksSection = hasVisibleModules || showLinksColumn
  /** Two columns when both modules and any links column content appear. */
  const twoColumnModulesAndLinks = hasVisibleModules && showLinksColumn
  const logoMaxRem = clampWelcomeLogoMaxRem(config.welcomeLogoMaxRem)
  const welcomeLogoSrc = config.welcomeLogoPath?.trim()
    ? uploadsUrl(config.welcomeLogoPath.trim(), config.homeBrandingRevision ?? 0)
    : publicAsset('logo.png')

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-10 lg:gap-12">
        <section aria-label="Welcome" className="min-h-[3rem]">
          {loading ? (
            <p className="text-sm text-foreground/60">Loading…</p>
          ) : (
            <div
              className={
                config.showWelcomeLogo
                  ? 'flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8 lg:gap-12'
                  : ''
              }
            >
              {config.showWelcomeLogo ? (
                <div
                  className="mx-auto w-full min-w-0 shrink-0 sm:mx-0 sm:w-auto"
                  style={{ maxWidth: `${logoMaxRem}rem` }}
                >
                  <img
                    src={welcomeLogoSrc}
                    alt=""
                    className="block h-auto w-full rounded-xl object-contain shadow-sm"
                  />
                </div>
              ) : null}
              <div
                className={
                  config.showWelcomeLogo ? 'min-w-0 flex-1 lg:border-l lg:border-border lg:pl-8 xl:pl-12' : ''
                }
              >
                <HomeIntroMarkdown content={config.introMarkdown} />
              </div>
            </div>
          )}
        </section>

        {!loading && showModulesAndLinksSection ? (
          <section
            aria-label="Modules and links"
            className={
              twoColumnModulesAndLinks
                ? 'grid grid-cols-1 gap-10 md:grid-cols-2 md:items-stretch md:gap-12'
                : 'flex justify-center'
            }
          >
            {hasVisibleModules ? (
              <div
                className={
                  twoColumnModulesAndLinks ? 'flex min-h-0 min-w-0 flex-col' : 'w-full max-w-md'
                }
              >
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/50">
                  Modules
                </p>
                <ul className="flex flex-col gap-3">
                  {visibleModules.map((m) => (
                    <li key={m.id} className="flex">
                      <HomeLinkCard
                        title={m.title}
                        description={m.description}
                        href={m.to}
                        moduleIconId={m.id}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {showLinksColumn ? (
              <div
                className={
                  twoColumnModulesAndLinks
                    ? 'flex min-h-0 min-w-0 flex-col md:border-l md:border-border md:pl-8 lg:pl-12'
                    : hubLinkColumns > 1
                      ? 'w-full max-w-5xl'
                      : 'w-full max-w-md'
                }
              >
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/50">Links</p>
                <div className="flex flex-col gap-3">
                  <ul
                    className={hubLinkColumns <= 1 ? 'flex flex-col gap-3' : 'min-w-0 w-full'}
                    style={hubLinksMulticolStyle}
                  >
                    {hubSlice.map((link: HomeCustomLink) => (
                      <li key={link.id} className="flex min-h-0 min-w-0">
                        <HomeLinkCard
                          title={link.title}
                          description={link.description}
                          href={link.href}
                        />
                      </li>
                    ))}
                  </ul>
                  {showLinksDirectoryCard ? (
                    <div className="w-full min-w-0">
                      <HomeLinkCard
                        title="All links"
                        description="Open the full directory of curated links."
                        href="/links"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {editOpen && (
        <HomePageEditModal
          initial={config}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => {
            setConfig((prev) => ({
              introMarkdown:
                typeof next.introMarkdown === 'string' && next.introMarkdown.trim()
                  ? next.introMarkdown
                  : FALLBACK_HOME.introMarkdown,
              customLinks: Array.isArray(next.customLinks) ? next.customLinks : [],
              linkCategories: Array.isArray(next.linkCategories) ? next.linkCategories : [],
              moduleOrder: mergeHomeModuleOrder(
                Array.isArray(next.moduleOrder) ? next.moduleOrder : undefined
              ),
              modulesHiddenFromHome: normalizeModulesHiddenFromHomeApi(next.modulesHiddenFromHome),
              showWelcomeLogo: next.showWelcomeLogo === true,
              welcomeLogoMaxRem: clampWelcomeLogoMaxRem(next.welcomeLogoMaxRem),
              welcomeLogoPath:
                typeof next.welcomeLogoPath === 'string' && next.welcomeLogoPath.trim()
                  ? next.welcomeLogoPath.trim()
                  : null,
              siteFaviconPath:
                typeof next.siteFaviconPath === 'string' && next.siteFaviconPath.trim()
                  ? next.siteFaviconPath.trim()
                  : null,
              homeBrandingRevision:
                typeof next.homeBrandingRevision === 'number' ? next.homeBrandingRevision : 0,
              customLinksInitialVisibleCount:
                typeof next.customLinksInitialVisibleCount === 'number'
                  ? next.customLinksInitialVisibleCount
                  : DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT,
              homeHubLinkColumns: clampHomeHubLinkColumns(
                typeof next.homeHubLinkColumns === 'number' && Number.isFinite(next.homeHubLinkColumns)
                  ? next.homeHubLinkColumns
                  : prev.homeHubLinkColumns
              ),
              linksPageLinkColumns: clampHomeHubLinkColumns(
                typeof next.linksPageLinkColumns === 'number' && Number.isFinite(next.linksPageLinkColumns)
                  ? next.linksPageLinkColumns
                  : prev.linksPageLinkColumns ?? DEFAULT_HOME_HUB_LINK_COLUMNS
              ),
              homeHubColumnCategoryIds: Array.isArray(next.homeHubColumnCategoryIds)
                ? next.homeHubColumnCategoryIds
                : prev.homeHubColumnCategoryIds,
              homeHubCategoryColumnMap:
                next.homeHubCategoryColumnMap && typeof next.homeHubCategoryColumnMap === 'object'
                  ? (next.homeHubCategoryColumnMap as Record<string, number>)
                  : prev.homeHubCategoryColumnMap,
              homeHubOtherLinksColumn:
                typeof next.homeHubOtherLinksColumn === 'number' && Number.isFinite(next.homeHubOtherLinksColumn)
                  ? Math.floor(next.homeHubOtherLinksColumn)
                  : next.homeHubOtherLinksColumn === null
                    ? null
                    : prev.homeHubOtherLinksColumn,
            }))
            applyIconsFromHomeBrandingPayload({
              siteFaviconPath: next.siteFaviconPath,
              homeBrandingRevision: next.homeBrandingRevision,
            })
          }}
        />
      )}
    </div>
  )
}
