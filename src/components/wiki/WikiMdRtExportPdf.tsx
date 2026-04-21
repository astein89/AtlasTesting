import type { CSSProperties } from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { MdPreview } from 'md-editor-rt'
import type { PreviewThemes, Themes } from 'md-editor-rt'
import { downloadPreviewElementAsPdf, getMdPreviewArticleEl } from '@/lib/wikiMdPdfDownload'
import './wikiMdRtExportPdf.css'

export function schedulePrint(
  previewId: string,
  onError?: (err: unknown) => void,
  onSuccess?: () => void
) {
  const run = () => {
    if (!document.getElementById(previewId)) {
      onError?.(new Error('Print preview not ready. Close and open the dialog, then try again.'))
      return
    }
    const prev = window.onafterprint
    window.onafterprint = () => {
      window.onafterprint = prev ?? null
      onSuccess?.()
    }
    window.print()
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(run, 0)
    })
  })
}

/** Opens the browser print dialog immediately (e.g. wiki article view already shows `.wiki-print-article`). */
export function scheduleBrowserPrint(onSuccess?: () => void) {
  const run = () => {
    const prev = window.onafterprint
    window.onafterprint = () => {
      window.onafterprint = prev ?? null
      onSuccess?.()
    }
    window.print()
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(run, 0)
    })
  })
}

const mdHeadingIdForExport = ({ index }: { index: number }) => `pdf-ex-heading-${index}`

function WikiMdRtPreviewShell({
  previewElementId,
  value,
  theme,
  previewTheme = 'default',
  codeTheme = 'atom',
  language,
  onHtmlChanged,
}: {
  previewElementId: string
  value: string
  theme: Themes
  previewTheme?: PreviewThemes
  codeTheme?: string
  language: string
  onHtmlChanged?: () => void
}) {
  return (
    <div className="export-pdf-content" data-wiki-export-pdf-root>
      <MdPreview
        id={previewElementId}
        theme={theme}
        codeTheme={codeTheme}
        previewTheme={previewTheme}
        language={language}
        value={value}
        mdHeadingId={mdHeadingIdForExport}
        codeFoldable={false}
        showCodeRowNumber={false}
        onHtmlChanged={onHtmlChanged}
      />
    </div>
  )
}

const PDF_OFFSCREEN_STYLE: CSSProperties = {
  position: 'fixed',
  left: '-9999px',
  top: 0,
  width: 'min(816px, 92vw)',
  opacity: 0,
  pointerEvents: 'none',
  zIndex: -1,
  overflow: 'hidden',
}

/** Screen-only placement for toolbar print clone: avoid opacity 0 / negative z-index (often print as blank). */
const PRINT_OFFSCREEN_SCREEN_STYLE: CSSProperties = {
  position: 'fixed',
  left: '-10000px',
  top: 0,
  width: 'min(816px, 92vw)',
  pointerEvents: 'none',
  zIndex: 0,
  overflow: 'hidden',
}

/**
 * Renders MdPreview off-screen and downloads PDF when ready (no visible preview UI).
 */
function WikiMdRtPdfOffscreenEngine({
  runId,
  onDone,
  previewElementId,
  value,
  pdfFileBaseName,
  previewTheme = 'default',
  codeTheme = 'atom',
  language = 'en-US',
  onError,
  onSuccess,
}: {
  runId: number | null
  onDone: () => void
  previewElementId: string
  value: string
  pdfFileBaseName: string
  previewTheme?: PreviewThemes
  codeTheme?: string
  language?: string
  onError?: (err: unknown) => void
  onSuccess?: () => void
}) {
  const ranRef = useRef(false)
  const debounceRef = useRef<number>()

  const finish = useCallback(() => {
    ranRef.current = false
    onDone()
  }, [onDone])

  const attemptDownload = useCallback(async () => {
    if (ranRef.current) return
    const el = getMdPreviewArticleEl(previewElementId)
    if (!el) return
    ranRef.current = true
    try {
      await downloadPreviewElementAsPdf(el, pdfFileBaseName)
      onSuccess?.()
    } catch (e: unknown) {
      onError?.(e)
    } finally {
      finish()
    }
  }, [previewElementId, pdfFileBaseName, onError, onSuccess, finish])

  const onPreviewHtmlChanged = useCallback(() => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => void attemptDownload(), 400)
  }, [attemptDownload])

  useEffect(() => {
    if (runId === null) {
      ranRef.current = false
      return
    }
    ranRef.current = false
    const t = window.setTimeout(() => void attemptDownload(), 750)
    return () => window.clearTimeout(t)
  }, [runId, attemptDownload])

  if (runId === null) return null

  return createPortal(
    <div style={PDF_OFFSCREEN_STYLE} aria-hidden>
      <WikiMdRtPreviewShell
        previewElementId={previewElementId}
        value={value}
        theme="light"
        previewTheme={previewTheme}
        codeTheme={codeTheme}
        language={language}
        onHtmlChanged={onPreviewHtmlChanged}
      />
    </div>,
    document.body
  )
}

/**
 * Off-screen MdPreview + print dialog (editor toolbar). Wrapper uses `wiki-print-article` so
 * global wiki print CSS applies.
 */
function WikiMdRtPrintOffscreenEngine({
  runId,
  onDone,
  previewElementId,
  value,
  previewTheme = 'default',
  codeTheme = 'atom',
  language = 'en-US',
  theme,
  onError,
  onSuccess,
}: {
  runId: number | null
  onDone: () => void
  previewElementId: string
  value: string
  previewTheme?: PreviewThemes
  codeTheme?: string
  language?: string
  theme: Themes
  onError?: (err: unknown) => void
  onSuccess?: () => void
}) {
  const ranRef = useRef(false)
  const debounceRef = useRef<number>()

  const finish = useCallback(() => {
    ranRef.current = false
    onDone()
  }, [onDone])

  const attemptPrint = useCallback(() => {
    if (ranRef.current) return
    if (!document.getElementById(previewElementId)) return
    ranRef.current = true
    schedulePrint(
      previewElementId,
      (err) => {
        onError?.(err)
        finish()
      },
      () => {
        onSuccess?.()
        finish()
      }
    )
  }, [previewElementId, onError, onSuccess, finish])

  const onPreviewHtmlChanged = useCallback(() => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => void attemptPrint(), 400)
  }, [attemptPrint])

  useEffect(() => {
    if (runId === null) {
      ranRef.current = false
      return
    }
    ranRef.current = false
    const t = window.setTimeout(() => void attemptPrint(), 750)
    return () => window.clearTimeout(t)
  }, [runId, attemptPrint])

  if (runId === null) return null

  return createPortal(
    <div
      className="wiki-print-article wiki-print-offscreen-print"
      style={PRINT_OFFSCREEN_SCREEN_STYLE}
      aria-hidden
    >
      <WikiMdRtPreviewShell
        previewElementId={previewElementId}
        value={value}
        theme={theme}
        previewTheme={previewTheme}
        codeTheme={codeTheme}
        language={language}
        onHtmlChanged={onPreviewHtmlChanged}
      />
    </div>,
    document.body
  )
}

/** Print + Download PDF controls for wiki article view (two toolbar buttons). */
export function WikiMdRtArticleExportButtons({
  markdown,
  disabled,
  pdfFileBaseName,
}: {
  markdown: string
  disabled?: boolean
  /** Saved filename without `.pdf` (special characters sanitized). */
  pdfFileBaseName: string
}) {
  const reactId = useId().replace(/:/g, '')
  const pdfPreviewId = `wiki-view-pdf-${reactId}`
  const [pdfRunId, setPdfRunId] = useState<number | null>(null)

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => scheduleBrowserPrint()}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80 disabled:opacity-50"
        aria-label="Print"
        title="Print"
      >
        <PrinterIcon />
      </button>
      <button
        type="button"
        disabled={disabled || pdfRunId !== null}
        onClick={() => setPdfRunId(Date.now())}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80 disabled:opacity-50"
        aria-label="Download PDF"
        title="Download PDF"
      >
        <PdfFileIcon />
      </button>
      <WikiMdRtPdfOffscreenEngine
        runId={pdfRunId}
        onDone={() => setPdfRunId(null)}
        previewElementId={pdfPreviewId}
        value={markdown}
        pdfFileBaseName={pdfFileBaseName}
      />
    </>
  )
}

/** Toolbar: opens print dialog (off-screen preview + same pipeline as published page). */
export const WikiMdRtPrintToolbar = forwardRef<
  unknown,
  {
    previewElementId: string
    value: string
    title?: string
    language?: string
    theme?: Themes
    previewTheme?: PreviewThemes
    codeTheme?: string
    disabled?: boolean
    showToolbarName?: boolean
    onError?: (err: unknown) => void
    onSuccess?: () => void
  }
>(function WikiMdRtPrintToolbar(
  {
    previewElementId,
    value,
    title = 'Print',
    language = 'en-US',
    theme = 'light',
    previewTheme = 'default',
    codeTheme = 'atom',
    disabled,
    showToolbarName,
    onError,
    onSuccess,
  },
  ref
) {
  const [printRunId, setPrintRunId] = useState<number | null>(null)
  const busy = printRunId !== null

  const startPrint = useCallback(() => setPrintRunId(Date.now()), [])

  useImperativeHandle(ref, () => ({ trigger: startPrint }), [startPrint])

  return (
    <>
      <button
        type="button"
        className="md-editor-toolbar-item"
        title={title}
        aria-label={title}
        disabled={disabled || busy}
        onClick={startPrint}
      >
        <PrinterIcon />
        {showToolbarName ? <div className="md-editor-toolbar-item-name">{title}</div> : null}
      </button>
      <WikiMdRtPrintOffscreenEngine
        runId={printRunId}
        onDone={() => setPrintRunId(null)}
        previewElementId={previewElementId}
        value={value}
        previewTheme={previewTheme}
        codeTheme={codeTheme}
        language={language}
        theme={theme}
        onError={onError}
        onSuccess={onSuccess}
      />
    </>
  )
})

/** Toolbar: instant PDF download (off-screen preview + jsPDF/html2canvas); no modal. */
export const WikiMdRtPdfToolbar = forwardRef<
  unknown,
  {
    previewElementId: string
    value: string
    pdfFileBaseName: string
    title?: string
    language?: string
    previewTheme?: PreviewThemes
    codeTheme?: string
    disabled?: boolean
    showToolbarName?: boolean
    onError?: (err: unknown) => void
    onSuccess?: () => void
  }
>(function WikiMdRtPdfToolbar(
  {
    previewElementId,
    value,
    pdfFileBaseName,
    title = 'PDF',
    language = 'en-US',
    previewTheme = 'default',
    codeTheme = 'atom',
    disabled,
    showToolbarName,
    onError,
    onSuccess,
  },
  ref
) {
  const [pdfRunId, setPdfRunId] = useState<number | null>(null)
  const busy = pdfRunId !== null

  const startPdf = useCallback(() => setPdfRunId(Date.now()), [])

  useImperativeHandle(ref, () => ({ trigger: startPdf }), [startPdf])

  return (
    <>
      <button
        type="button"
        className="md-editor-toolbar-item"
        title={title}
        aria-label={title}
        disabled={disabled || busy}
        onClick={startPdf}
      >
        <PdfFileIcon />
        {showToolbarName ? <div className="md-editor-toolbar-item-name">{title}</div> : null}
      </button>
      <WikiMdRtPdfOffscreenEngine
        runId={pdfRunId}
        onDone={() => setPdfRunId(null)}
        previewElementId={previewElementId}
        value={value}
        pdfFileBaseName={pdfFileBaseName}
        previewTheme={previewTheme}
        codeTheme={codeTheme}
        language={language}
        onError={onError}
        onSuccess={onSuccess}
      />
    </>
  )
})

function PrinterIcon() {
  return (
    <svg
      className="md-editor-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
      <rect width="12" height="8" x="6" y="14" rx="1" />
    </svg>
  )
}

function PdfFileIcon() {
  return (
    <svg
      className="md-editor-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        stroke="none"
        fontFamily="system-ui, ui-sans-serif, sans-serif"
        fontSize="7"
        fontWeight="700"
        letterSpacing="-0.02em"
      >
        PDF
      </text>
    </svg>
  )
}
