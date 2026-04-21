/** localStorage key for wiki / home markdown editor preview visibility */
export const WIKI_EDITOR_SHOW_PREVIEW_KEY = 'wiki.editor.showPreview'

export function readInitialWikiEditorShowPreview(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const v = localStorage.getItem(WIKI_EDITOR_SHOW_PREVIEW_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return window.matchMedia('(min-width: 1024px)').matches
}

export function persistWikiEditorShowPreview(visible: boolean): void {
  try {
    localStorage.setItem(WIKI_EDITOR_SHOW_PREVIEW_KEY, visible ? '1' : '0')
  } catch {
    /* ignore */
  }
}
