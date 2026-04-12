import { api } from './client'

/** Must match `MAX_MARKDOWN_CHARS` in `server/routes/wiki.ts`. */
export const WIKI_MAX_MARKDOWN_CHARS = 500_000

export type WikiPageListItem = { path: string; title?: string }

/** `section` = content lives in `path/index.md`; `page` = flat `path.md`. */
export type WikiPageKind = 'page' | 'section'

export async function fetchWikiPages(signal?: AbortSignal): Promise<WikiPageListItem[]> {
  const { data } = await api.get<WikiPageListItem[]>('/wiki/pages', { signal })
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

export async function fetchWikiPage(
  path: string,
  signal?: AbortSignal
): Promise<{
  path: string
  markdown: string
  pageKind?: WikiPageKind
  /** Stored display name; null = use first markdown heading for sidebar until set. */
  pageTitle: string | null
  viewRoleSlugs?: string[] | null
  /** Section index only: when false, “Pages in this section” is hidden on the wiki view. */
  showSectionPages?: boolean
}> {
  const { data } = await api.get<{
    path: string
    markdown: string
    pageKind?: WikiPageKind
    pageTitle?: string | null
    viewRoleSlugs?: string[] | null
    showSectionPages?: boolean
  }>('/wiki/page', {
    params: { path },
    signal,
  })
  return {
    ...data,
    pageTitle: data.pageTitle ?? null,
  }
}

export type WikiSidebarOrderMap = Record<string, string[]>

export async function fetchWikiSidebarOrder(signal?: AbortSignal): Promise<WikiSidebarOrderMap> {
  const { data } = await api.get<WikiSidebarOrderMap>('/wiki/order', { signal })
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
    /** Omitted = leave stored title unchanged; null = clear (sidebar falls back to first # heading). */
    pageTitle?: string | null
  }
): Promise<{
  path: string
  pageTitle?: string | null
  viewRoleSlugs?: string[] | null
  showSectionPages?: boolean
}> {
  const params: Record<string, string> = { path }
  if (opts?.asIndex) params.as = 'index'
  const body: {
    markdown: string
    viewRoleSlugs?: string[] | null
    showSectionPages?: boolean
    pageTitle?: string | null
  } = { markdown }
  if (opts && 'viewRoleSlugs' in opts) {
    body.viewRoleSlugs = opts.viewRoleSlugs?.length ? opts.viewRoleSlugs : null
  }
  if (opts && 'showSectionPages' in opts && opts.showSectionPages !== undefined) {
    body.showSectionPages = opts.showSectionPages
  }
  if (opts && 'pageTitle' in opts) {
    const v = opts.pageTitle
    if (v === null || v === undefined) {
      body.pageTitle = null
    } else {
      body.pageTitle = v.trim() || null
    }
  }
  const { data } = await api.put<{
    path: string
    pageTitle?: string | null
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

export type WikiRecycleListItem = {
  storageRel: string
  wikiPath: string
  deletedAt: string
  title?: string
}

export async function listWikiRecyclePages(
  signal?: AbortSignal
): Promise<{ items: WikiRecycleListItem[]; retentionDays: number }> {
  const { data } = await api.get<{ items: WikiRecycleListItem[]; retentionDays: number }>('/wiki/recycle', {
    signal,
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    retentionDays: typeof data?.retentionDays === 'number' ? data.retentionDays : 30,
  }
}

export async function restoreWikiRecyclePage(storageRel: string): Promise<{ ok: boolean; path: string }> {
  const { data } = await api.post<{ ok: boolean; path: string }>('/wiki/recycle/restore', { storageRel })
  return data
}

export async function permanentlyDeleteWikiRecyclePage(storageRel: string): Promise<void> {
  await api.delete('/wiki/recycle/permanent', { data: { storageRel } })
}
