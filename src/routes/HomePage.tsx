import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { appModules, getModuleRequiredPermission } from '@/config/modules'
import { HomeIntroMarkdown } from '@/components/home/HomeIntroMarkdown'
import { HomeLinkCard } from '@/components/home/HomeLinkCard'
import { HomePageEditModal } from '@/components/home/HomePageEditModal'
import { publicAsset } from '@/lib/basePath'
import { WELCOME_LOGO_DEFAULT_REM, clampWelcomeLogoMaxRem } from '@/lib/welcomeLogoSize'
import { useAuthStore } from '@/store/authStore'
import { useHomePageEditStore } from '@/store/homePageEditStore'
import type { HomeCustomLink, HomePageConfig } from '@/types/homePage'

/** Shown only if `/api/home` fails; normal default is `content/home-intro.md` on the server. */
const FALLBACK_HOME: HomePageConfig = {
  introMarkdown:
    '# Welcome to **DC Automation**\n\nUse the modules to open **Testing** or **Locations**. Sign in when needed.\n\nIf this message persists, the home configuration could not be loaded—check the API and network.',
  customLinks: [],
  showWelcomeLogo: false,
  welcomeLogoMaxRem: WELCOME_LOGO_DEFAULT_REM,
}

function userRoleSlugs(user: ReturnType<typeof useAuthStore.getState>['user']): string[] {
  if (!user) return []
  if (user.roles && user.roles.length > 0) return user.roles
  if (user.role?.trim()) return [user.role.trim()]
  return []
}

function customLinkVisible(
  link: HomeCustomLink,
  hasPermission: (k: string) => boolean,
  roles: string[]
): boolean {
  if (link.allowedRoleSlugs && link.allowedRoleSlugs.length > 0) {
    const set = new Set(roles)
    return link.allowedRoleSlugs.some((s) => set.has(s))
  }
  if (link.requiredPermission?.trim()) {
    return hasPermission(link.requiredPermission.trim())
  }
  return true
}

export function HomePage() {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const user = useAuthStore((s) => s.user)
  const [config, setConfig] = useState<HomePageConfig>(FALLBACK_HOME)
  const [loading, setLoading] = useState(true)
  const editOpen = useHomePageEditStore((s) => s.editorOpen)
  const setEditOpen = useHomePageEditStore((s) => s.setEditorOpen)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<HomePageConfig & { introSubtitle?: string; introTitle?: string }>(
        '/home'
      )
      let introMarkdown =
        typeof data.introMarkdown === 'string' && data.introMarkdown.trim()
          ? data.introMarkdown
          : ''
      if (!introMarkdown && typeof data.introSubtitle === 'string') introMarkdown = data.introSubtitle
      if (!introMarkdown.trim()) introMarkdown = FALLBACK_HOME.introMarkdown
      setConfig({
        introMarkdown,
        customLinks: Array.isArray(data.customLinks) ? data.customLinks : [],
        showWelcomeLogo: data.showWelcomeLogo === true,
        welcomeLogoMaxRem: clampWelcomeLogoMaxRem(data.welcomeLogoMaxRem),
      })
    } catch {
      setConfig(FALLBACK_HOME)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () => () => {
      setEditOpen(false)
    },
    [setEditOpen]
  )

  const visibleModules = appModules.filter((m) => hasPermission(getModuleRequiredPermission(m)))

  const roleSlugs = userRoleSlugs(user)
  const visibleCustomLinks = config.customLinks.filter((link) =>
    customLinkVisible(link, hasPermission, roleSlugs)
  )
  const hasExtraLinks = visibleCustomLinks.length > 0
  const logoMaxRem = clampWelcomeLogoMaxRem(config.welcomeLogoMaxRem)

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
                    src={publicAsset('logo.png')}
                    alt="DC Automation"
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

        <section
          aria-label="Modules and links"
          className={
            hasExtraLinks
              ? 'grid grid-cols-1 gap-10 md:grid-cols-2 md:items-stretch md:gap-12'
              : 'flex justify-center'
          }
        >
          <div className={hasExtraLinks ? 'flex min-h-0 min-w-0 flex-col' : 'w-full max-w-md'}>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/50">Modules</p>
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
          {hasExtraLinks ? (
            <div className="flex min-h-0 min-w-0 flex-col md:border-l md:border-border md:pl-8 lg:pl-12">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/50">Links</p>
              <ul className="flex flex-col gap-3">
                {visibleCustomLinks.map((link) => (
                  <li key={link.id} className="flex">
                    <HomeLinkCard
                      title={link.title}
                      description={link.description}
                      href={link.href}
                      showUrl
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      {editOpen && (
        <HomePageEditModal
          initial={config}
          onClose={() => setEditOpen(false)}
          onSaved={(next) =>
            setConfig({
              introMarkdown:
                typeof next.introMarkdown === 'string' && next.introMarkdown.trim()
                  ? next.introMarkdown
                  : FALLBACK_HOME.introMarkdown,
              customLinks: Array.isArray(next.customLinks) ? next.customLinks : [],
              showWelcomeLogo: next.showWelcomeLogo === true,
              welcomeLogoMaxRem: clampWelcomeLogoMaxRem(next.welcomeLogoMaxRem),
            })
          }
        />
      )}
    </div>
  )
}
