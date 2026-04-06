import { api } from './client'

/** Must match `MAX_MARKDOWN_CHARS` in `server/routes/wiki.ts`. */
export const WIKI_MAX_MARKDOWN_CHARS = 500_000

export type WikiPageListItem = { path: string; title?: string }

/** `section` = content lives in `path/index.md`; `page` = flat `path.md`. */
export type WikiPageKind = 'page' | 'section'

export async function fetchWikiPages(): Promise<WikiPageListItem[]> {
  const { data } = await api.get<WikiPageListItem[]>('/wiki/pages')
  return Array.isArray(data) ? data : []
}

/** Suggested URL segment under parentPath (empty = wiki root), unique among sibling pages on disk. */
export async function fetchWikiSlugSuggestion(
  parentPath: string,
  title: string,
  signal?: AbortSignal
): Promise<{ slug: string }> {
  const { data } = await api.get<{ slug: string }>('/wiki/slug-suggestion', {
    params: { title, parentPath: parentPath || '' },
    signal,
  })
  return data
}

/** Slug/label pairs for wiki page visibility (requires wiki.edit). */
export async function fetchWikiRoleOptions(): Promise<Array<{ slug: string; label: string }>> {
  const { data } = await api.get<Array<{ slug: string; label: string }>>('/wiki/role-options')
  return Array.isArray(data) ? data : []
}

export async function fetchWikiPage(path: string): Promise<{
  path: string
  markdown: string
  pageKind?: WikiPageKind
  viewRoleSlugs?: string[] | null
  /** Section index only: when false, “Pages in this section” is hidden on the wiki view. */
  showSectionPages?: boolean
}> {
  const { data } = await api.get<{
    path: string
    markdown: string
    pageKind?: WikiPageKind
    viewRoleSlugs?: string[] | null
    showSectionPages?: boolean
  }>('/wiki/page', {
    params: { path },
  })
  return data
}

export type WikiSidebarOrderMap = Record<string, string[]>

export async function fetchWikiSidebarOrder(): Promise<WikiSidebarOrderMap> {
  const { data } = await api.get<WikiSidebarOrderMap>('/wiki/order')
  return data && typeof data === 'object' ? data : {}
}

export async function saveWikiSidebarOrder(orders: WikiSidebarOrderMap): Promise<void> {
  await api.put('/wiki/order', { orders })
}

/** Rename / move a wiki page or section folder to a new path. */
export async function moveWikiPage(from: string, to: string): Promise<{ path: string }> {
  const { data } = await api.put<{ path: string }>('/wiki/move', { from, to })
  return data
}

export async function saveWikiPage(
  path: string,
  markdown: string,
  opts?: {
    asIndex?: boolean
    viewRoleSlugs?: string[] | null
    /** Section index only; omitted = do not change stored preference. */
    showSectionPages?: boolean
  }
): Promise<{ path: string; viewRoleSlugs?: string[] | null; showSectionPages?: boolean }> {
  const params: Record<string, string> = { path }
  if (opts?.asIndex) params.as = 'index'
  const body: {
    markdown: string
    viewRoleSlugs?: string[] | null
    showSectionPages?: boolean
  } = { markdown }
  if (opts && 'viewRoleSlugs' in opts) {
    body.viewRoleSlugs = opts.viewRoleSlugs?.length ? opts.viewRoleSlugs : null
  }
  if (opts && 'showSectionPages' in opts && opts.showSectionPages !== undefined) {
    body.showSectionPages = opts.showSectionPages
  }
  const { data } = await api.put<{
    path: string
    viewRoleSlugs?: string[] | null
    showSectionPages?: boolean
  }>('/wiki/page', body, {
    params,
  })
  return data
}

/** Moves the page's .md file under content/wiki/_deleted/ (soft delete). */
export async function archiveWikiPage(path: string): Promise<{ ok: boolean; movedTo: string }> {
  const { data } = await api.delete<{ ok: boolean; movedTo: string }>('/wiki/page', {
    params: { path },
  })
  return data
}
