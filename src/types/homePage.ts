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
}
