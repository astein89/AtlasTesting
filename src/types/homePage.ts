export interface HomeCustomLink {
  id: string
  title: string
  description: string
  href: string
  /**
   * If non-empty, only users who have at least one of these role slugs see the link.
   * If empty/omitted, no role restriction (everyone who can open Home).
   */
  allowedRoleSlugs?: string[]
  /** @deprecated Prefer `allowedRoleSlugs`. If set (and no role list), visibility uses this permission key. */
  requiredPermission?: string
}

export interface HomePageConfig {
  /** Markdown body shown on the home hub (welcome area). */
  introMarkdown: string
  customLinks: HomeCustomLink[]
  /**
   * Order of module card ids on the home hub (e.g. `testing`, `locations`, `wiki`, `admin`).
   * Omitted or partial lists are merged with defaults on load.
   */
  moduleOrder?: string[]
  /**
   * Module ids to omit from home module cards. Modules remain available from the sidebar and
   * direct URLs; only the home hub cards are affected.
   */
  modulesHiddenFromHome?: string[]
  /** When true, show the welcome logo beside the Markdown (left on wide viewports). */
  showWelcomeLogo?: boolean
  /** Max width of the welcome logo in `rem` (clamped server-side; default 16). */
  welcomeLogoMaxRem?: number
  /**
   * Path under server `uploads/` (e.g. `home/welcome-logo.png`), served at `/api/uploads/...`.
   * Omitted or null = use `public/logo.png`.
   */
  welcomeLogoPath?: string | null
  /** Same for the browser tab / PWA icon; null = `public/icon.png`. */
  siteFaviconPath?: string | null
  /** Server-incremented when branding images change (cache bust). */
  homeBrandingRevision?: number
}
