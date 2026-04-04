import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { appModules, getModuleRequiredPermission } from '@/config/modules'
import { HomeIntroMarkdown } from '@/components/home/HomeIntroMarkdown'
import { HomeLinkCard } from '@/components/home/HomeLinkCard'
import { HomePageEditModal } from '@/components/home/HomePageEditModal'
import { useAuthStore } from '@/store/authStore'
import { useHomePageEditStore } from '@/store/homePageEditStore'
import type { HomeCustomLink, HomePageConfig } from '@/types/homePage'

/** Shown only if `/api/home` fails; normal default is `content/home-intro.md` on the server. */
const FALLBACK_HOME: HomePageConfig = {
  introMarkdown:
    '# Welcome to **DC Automation**\n\nUse the modules to open **Testing** or **Locations**. Sign in when needed.\n\nIf this message persists, the home configuration could not be loaded—check the API and network.',
  customLinks: [],
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-stretch lg:gap-12">
        <aside className="order-2 w-full shrink-0 lg:order-1 lg:w-80">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/50 lg:hidden">
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
          {visibleCustomLinks.length > 0 && (
            <>
              <div className="my-3 flex items-center gap-2 sm:my-4" role="separator">
                <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-foreground/50">
                  Links
                </span>
                <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
              </div>
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
            </>
          )}
        </aside>

        <div className="order-1 flex-1 lg:order-2 lg:min-h-[12rem] lg:border-l lg:border-border lg:pl-12">
          {loading ? (
            <p className="text-sm text-foreground/60">Loading…</p>
          ) : (
            <HomeIntroMarkdown content={config.introMarkdown} />
          )}
        </div>
      </div>

      {editOpen && (
        <HomePageEditModal
          initial={config}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => setConfig(next)}
        />
      )}
    </div>
  )
}
