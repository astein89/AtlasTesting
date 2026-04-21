import { useCallback, useId, useState, useSyncExternalStore } from 'react'
import axios from 'axios'
import { Emoji } from '@vavt/rt-extension'
import '@vavt/rt-extension/lib/asset/Emoji.css'
import '@vavt/rt-extension/lib/asset/ExportPDF.css'
import { WikiMdRtPdfToolbar, WikiMdRtPrintToolbar } from '@/components/wiki/WikiMdRtExportPdf'
import { MdEditor, allToolbar } from 'md-editor-rt'
import type { ToolbarNames } from 'md-editor-rt'
import 'md-editor-rt/lib/style.css'
import '@/components/wiki/wikiMdRtExportPdf.css'
import '@/components/wiki/wikiMdRtToolbarOverflow.css'
import { WikiEditorHelpModal } from '@/components/wiki/WikiEditorHelpModal'
import { WikiMdRtImageToolbar } from '@/components/wiki/WikiMdRtImageToolbar'
import type { WikiMarkdownEditorLayout } from '@/components/wiki/wikiMarkdownEditorTypes'
import { uploadWikiEditorImages } from '@/api/wiki'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { getBasePath } from '@/lib/basePath'
import { patchTaskListCheckboxDataLine } from '@/lib/mdEditorRtTaskListDom'

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

/**
 * Default toolbar minus catalog and the built-in image control; custom slots: `0` = Emoji, `1` = Print, `2` = PDF, `3` = image
 * (dropdown with “add link” modal + upload + crop).
 */
function wikiMdRtToolbars(): ToolbarNames[] {
  const base = allToolbar.filter((name) => name !== 'catalog' && name !== 'image')
  const katexIdx = base.indexOf('katex')
  let merged =
    katexIdx === -1 ? [...base, 0, 1, 2] : [...base.slice(0, katexIdx + 1), 0, 1, 2, ...base.slice(katexIdx + 1)]
  const tableIdx = merged.indexOf('table')
  if (tableIdx !== -1) {
    merged = [...merged.slice(0, tableIdx), 3, ...merged.slice(tableIdx)]
  }
  return merged
}

const WIKI_MD_RT_TOOLBARS = wikiMdRtToolbars()

export function WikiMarkdownEditorMdRt({
  value,
  onChange,
  disabled,
  historyResetKey,
  layout = 'page',
  onToolbarSave,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  historyResetKey?: string
  layout?: WikiMarkdownEditorLayout
  /** Toolbar save (disk icon): receives current markdown from the editor */
  onToolbarSave?: (markdown: string) => void | Promise<void>
}) {
  const inModal = layout === 'modal'
  const [helpOpen, setHelpOpen] = useState(false)
  const reactId = useId().replace(/:/g, '')
  const editorId = `wiki-md-rt-${reactId}`
  const { showAlert } = useAlertConfirm()

  const isDark = useSyncExternalStore(subscribeHtmlDark, getHtmlDarkSnapshot, () => false)

  const onUploadImg = useCallback(
    async (files: File[], callback: (urls: string[]) => void) => {
      try {
        const paths = await uploadWikiEditorImages(files)
        const urls = paths.map((p) => (p.startsWith('/') ? `${getBasePath()}${p}` : p))
        callback(urls)
      } catch (e: unknown) {
        const msg = axios.isAxiosError(e)
          ? ((e.response?.data as { error?: string } | undefined)?.error ?? e.message)
          : e instanceof Error
            ? e.message
            : 'Upload failed'
        void showAlert(msg)
      }
    },
    [showAlert]
  )

  /** Wiki page: grow with route flex chain. Modal: bounded height inside dialog. */
  const editorShellClass = inModal
    ? 'h-[min(58vh,32rem)] min-h-[16rem] w-full'
    : 'min-h-0 w-full flex-1'

  return (
    <div className="wiki-md-rt-shell flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-2 flex shrink-0 flex-col gap-2 border-b border-border pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-foreground/60">
          Rich editor — preview matches published pages (same md-editor-rt renderer). Use the toolbar for split view,
          fullscreen, emoji, print, PDF download, and more.
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setHelpOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-foreground hover:bg-foreground/[0.04] disabled:opacity-45 dark:hover:bg-foreground/[0.07]"
            title="Editor help (Markdown & Mermaid)"
            aria-label="Editor help"
          >
            ?
          </button>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col ${editorShellClass}`}>
        <MdEditor
          key={historyResetKey ?? 'wiki-md'}
          id={editorId}
          value={value}
          onChange={onChange}
          showCodeRowNumber={false}
          theme={isDark ? 'dark' : 'light'}
          language="en-US"
          disabled={disabled}
          inputBoxWidth="50%"
          onUploadImg={disabled ? undefined : onUploadImg}
          toolbars={WIKI_MD_RT_TOOLBARS}
          defToolbars={[
            <Emoji key="wiki-emoji" title="Emoji" />,
            <WikiMdRtPrintToolbar
              key="wiki-print"
              previewElementId={`${editorId}-export-print`}
              title="Print"
              language="en-US"
              theme={isDark ? 'dark' : 'light'}
              value={value}
              disabled={disabled}
            />,
            <WikiMdRtPdfToolbar
              key="wiki-pdf"
              previewElementId={`${editorId}-export-pdf`}
              pdfFileBaseName="wiki-draft"
              title="PDF"
              language="en-US"
              value={value}
              disabled={disabled}
            />,
            <WikiMdRtImageToolbar key="wiki-image-toolbar" editorId={editorId} />,
          ]}
          onSave={onToolbarSave ? (md) => void onToolbarSave(md) : undefined}
          onHtmlChanged={() => {
            queueMicrotask(() => {
              patchTaskListCheckboxDataLine(document.getElementById(`${editorId}-preview`))
            })
          }}
          className="!h-full min-h-0"
          style={{ height: '100%' }}
        />
      </div>
      <WikiEditorHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
