import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import { MdPreview } from 'md-editor-rt'
import 'md-editor-rt/lib/style.css'
import 'md-editor-rt/lib/preview.css'
import { patchTaskListCheckboxDataLine } from '@/lib/mdEditorRtTaskListDom'
import { createMdRtWikiHeadingId } from '@/lib/wikiHeadings'

function subscribeHtmlDark(callback: () => void): () => void {
  const el = document.documentElement
  const obs = new MutationObserver(callback)
  obs.observe(el, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('storage', callback)
  return () => {
    obs.disconnect()
    window.removeEventListener('storage', callback)
  }
}

function getHtmlDarkSnapshot(): boolean {
  return document.documentElement.classList.contains('dark')
}

export interface MarkdownMdRtViewProps {
  content: string
  /** Wiki article print stylesheet hook */
  wikiPrintBody?: boolean
  className?: string
  /** When set (e.g. classic editor), task-list toggles in preview update parent markdown. */
  onContentChange?: (next: string) => void
}

/**
 * Read-only Markdown using the same md-editor-rt preview pipeline as {@link MdEditor} (markdown-it, themes, Mermaid).
 */
export function MarkdownMdRtView({
  content,
  wikiPrintBody = false,
  className,
  onContentChange,
}: MarkdownMdRtViewProps) {
  const reactId = useId().replace(/:/g, '')
  const previewId = `md-rt-view-${reactId}`
  const isDark = useSyncExternalStore(subscribeHtmlDark, getHtmlDarkSnapshot, () => false)

  /** Controlled preview so GFM task-list clicks update (see md-editor-rt previewOnly + taskList enabled). */
  const [previewBody, setPreviewBody] = useState(content)
  useEffect(() => {
    setPreviewBody(content)
  }, [content])

  const mdHeadingId = useMemo(() => createMdRtWikiHeadingId(previewBody), [previewBody])

  if (!content.trim()) return null

  return (
    <div
      className={[wikiPrintBody ? 'wiki-print-article' : '', className ?? ''].filter(Boolean).join(' ')}
    >
      <MdPreview
        id={previewId}
        value={previewBody}
        showCodeRowNumber={false}
        onChange={(next) => {
          setPreviewBody(next)
          onContentChange?.(next)
        }}
        onHtmlChanged={() => {
          queueMicrotask(() => {
            patchTaskListCheckboxDataLine(document.getElementById(`${previewId}-preview`))
          })
        }}
        theme={isDark ? 'dark' : 'light'}
        language="en-US"
        previewTheme="default"
        mdHeadingId={mdHeadingId}
        className="max-w-none text-left"
      />
    </div>
  )
}
