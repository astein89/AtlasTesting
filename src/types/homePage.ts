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
  /** Optional group for hub / `/links` headings. */
  categoryId?: string | null
  /** When false, hidden from home hub cards (still on `/links`). Default true. */
  showOnHome?: boolean
  /** Order on the home hub among “show on home” links (lower first). */
  homeSortOrder?: number
}

export interface HomeLinkCategory {
  id: string
  title: string
  sortOrder: number
}

/** Custom labels and icon for a built-in module home card (`module id` → overrides). */
export interface ModuleCardOverride {
  title?: string
  description?: string
  /**
   * Use another module’s built-in icon artwork (same ids as app modules).
   * Omit or empty = use this module’s default icon.
   */
  iconModuleId?: string
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
  /** Optional title, description, and icon preset per module for home hub cards only. */
  moduleCardOverrides?: Record<string, ModuleCardOverride>
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
  /** Group headings for custom links (order + titles). */
  linkCategories?: HomeLinkCategory[]
  /** Max links that may use “show on home” at once (hub order wins when over limit). */
  customLinksInitialVisibleCount?: number
  /** Number of columns for link cards on the home hub (1–6). */
  homeHubLinkColumns?: number
  /** Columns for curated link cards on `/links` (1–6). Independent of home hub. */
  linksPageLinkColumns?: number
  /**
   * @deprecated Prefer `homeHubCategoryColumnMap`. Legacy: per-column category slots (same length as columns).
   */
  homeHubColumnCategoryIds?: (string | null)[]
  /** Category id → 0-based home hub column index (multiple categories may share a column). */
  homeHubCategoryColumnMap?: Record<string, number>
  /** Column index for uncategorized links and categories not assigned to a column. Null uses partition fallback. */
  homeHubOtherLinksColumn?: number | null
}
