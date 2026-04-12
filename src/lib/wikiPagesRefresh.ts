/** Dispatched after recycle restore/delete (and similar) so the wiki sidebar refetches the page list. */
export const WIKI_PAGES_REFRESH_EVENT = 'atlas-wiki-pages-refresh'

export function requestWikiPagesRefresh(): void {
  window.dispatchEvent(new Event(WIKI_PAGES_REFRESH_EVENT))
}
