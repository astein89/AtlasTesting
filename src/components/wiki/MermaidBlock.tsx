import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'

interface MermaidBlockProps {
  chart: string
}

type ExportBackground = 'white' | 'black' | 'transparent'
type ExportFileFormat = 'png' | 'svg'
/** Pixel size = diagram logical size × multiplier (from viewBox / width·height). */
type ExportSizeMultiplier = 1 | 2 | 4 | 8

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

const SIZE_MULTIPLIERS: ExportSizeMultiplier[] = [1, 2, 4, 8]

function formatPixelDimensions(logicalW: number, logicalH: number, mult: ExportSizeMultiplier): string {
  const { pixelW, pixelH } = capDimensions(logicalW * mult, logicalH * mult)
  return `${pixelW} × ${pixelH} px`
}

const MAX_EXPORT_DIM = 8192

/** Parse numeric width/height; ignore percentages so viewBox can win. */
function parseSvgLength(attr: string | null): number | null {
  if (!attr) return null
  const s = attr.trim()
  if (s.endsWith('%')) return null
  const n = parseFloat(s.replace(/px$/i, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Logical size from viewBox (user units), then width/height attrs. */
function parseSvgDimensions(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.getAttribute('viewBox')
  let vw = 0
  let vh = 0
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/)
    if (parts.length >= 4) {
      vw = parseFloat(parts[2]!)
      vh = parseFloat(parts[3]!)
    }
  }
  let w = parseSvgLength(svg.getAttribute('width'))
  let h = parseSvgLength(svg.getAttribute('height'))
  if (w == null || !(w > 0)) w = Number.isFinite(vw) && vw > 0 ? vw : 800
  if (h == null || !(h > 0)) h = Number.isFinite(vh) && vh > 0 ? vh : 600
  return { w, h }
}

function deepCloneSvg(svg: SVGSVGElement): SVGSVGElement {
  return svg.cloneNode(true) as SVGSVGElement
}

/** Standalone SVG file + reliable sizing for rasterization. */
function prepareSvgClone(svg: SVGSVGElement, pixelW: number, pixelH: number): SVGSVGElement {
  const clone = deepCloneSvg(svg)
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS)
  if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', XLINK_NS)
  clone.setAttribute('width', String(Math.max(1, Math.round(pixelW))))
  clone.setAttribute('height', String(Math.max(1, Math.round(pixelH))))
  if (!clone.getAttribute('viewBox')) {
    const { w, h } = parseSvgDimensions(svg)
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
  }
  return clone
}

/** Full-viewBox background rect behind diagram content (SVG export). */
function insertSvgBackgroundRect(clone: SVGSVGElement, background: ExportBackground): void {
  if (background === 'transparent') return
  const fill = background === 'white' ? '#ffffff' : '#000000'
  let x = 0
  let y = 0
  let w = 100
  let h = 100
  const vb = clone.getAttribute('viewBox')
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/)
    if (parts.length >= 4) {
      x = parseFloat(parts[0]!) || 0
      y = parseFloat(parts[1]!) || 0
      w = parseFloat(parts[2]!) || 100
      h = parseFloat(parts[3]!) || 100
    }
  } else {
    const dim = parseSvgDimensions(clone)
    w = dim.w
    h = dim.h
  }
  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('x', String(x))
  rect.setAttribute('y', String(y))
  rect.setAttribute('width', String(w))
  rect.setAttribute('height', String(h))
  rect.setAttribute('fill', fill)
  clone.insertBefore(rect, clone.firstChild)
}

function capDimensions(pw: number, ph: number): { pixelW: number; pixelH: number } {
  let pixelW = Math.max(1, Math.round(pw))
  let pixelH = Math.max(1, Math.round(ph))
  if (pixelW > MAX_EXPORT_DIM) {
    pixelH = Math.round((pixelH * MAX_EXPORT_DIM) / pixelW)
    pixelW = MAX_EXPORT_DIM
  }
  if (pixelH > MAX_EXPORT_DIM) {
    pixelW = Math.round((pixelW * MAX_EXPORT_DIM) / pixelH)
    pixelH = MAX_EXPORT_DIM
  }
  return { pixelW, pixelH }
}

function svgToSerializedString(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg)
}

function tryMsSaveBlob(blob: Blob, filename: string): boolean {
  const nav = navigator as Navigator & { msSaveOrOpenBlob?: (b: Blob, name: string) => boolean }
  if (typeof nav.msSaveOrOpenBlob === 'function') {
    nav.msSaveOrOpenBlob(blob, filename)
    return true
  }
  return false
}

async function saveBlobWithFallback(blob: Blob, filename: string, mime: string): Promise<void> {
  if (tryMsSaveBlob(blob, filename)) return

  const picker =
    typeof window.showSaveFilePicker === 'function' && window.isSecureContext
      ? window.showSaveFilePicker
      : undefined
  if (picker) {
    try {
      const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : ''
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: mime.startsWith('image/svg') ? 'SVG' : 'PNG image',
            accept: { [mime]: ext ? [ext] : ['*/*'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return
    }
  }

  triggerAnchorDownloadFromBlob(blob, filename)
}

function triggerAnchorDownloadFromBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.position = 'fixed'
  a.style.left = '-9999px'
  document.body.append(a)
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2500)
}

function triggerAnchorDownloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.rel = 'noopener'
  a.style.position = 'fixed'
  a.style.left = '-9999px'
  document.body.append(a)
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  a.remove()
}

async function downloadSvgFile(
  svgEl: SVGSVGElement,
  filename: string,
  opts: { background: ExportBackground; sizeMultiplier: ExportSizeMultiplier }
): Promise<void> {
  const { w: logicalW, h: logicalH } = parseSvgDimensions(svgEl)
  const { pixelW, pixelH } = capDimensions(logicalW * opts.sizeMultiplier, logicalH * opts.sizeMultiplier)

  const clone = prepareSvgClone(svgEl, pixelW, pixelH)
  insertSvgBackgroundRect(clone, opts.background)
  const data = svgToSerializedString(clone)
  const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' })

  if (tryMsSaveBlob(blob, filename)) return

  if (typeof window.showSaveFilePicker === 'function' && window.isSecureContext) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return
    }
  }

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`
  if (dataUrl.length < 1_800_000) {
    triggerAnchorDownloadDataUrl(dataUrl, filename)
    return
  }
  triggerAnchorDownloadFromBlob(blob, filename)
}

function downloadPngFromSvg(
  svgEl: SVGSVGElement,
  filename: string,
  opts: { background: ExportBackground; sizeMultiplier: ExportSizeMultiplier }
): Promise<void> {
  const { w: logicalW, h: logicalH } = parseSvgDimensions(svgEl)
  const { pixelW, pixelH } = capDimensions(logicalW * opts.sizeMultiplier, logicalH * opts.sizeMultiplier)

  const clone = prepareSvgClone(svgEl, pixelW, pixelH)
  insertSvgBackgroundRect(clone, opts.background)
  const data = svgToSerializedString(clone)
  const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const cleanupBlob = () => URL.revokeObjectURL(url)
      void (async () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, pixelW)
          canvas.height = Math.max(1, pixelH)
          const ctx = canvas.getContext('2d', {
            alpha: opts.background === 'transparent',
          })
          if (!ctx) {
            cleanupBlob()
            reject(new Error('No canvas context'))
            return
          }
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          if (opts.background === 'white') {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          } else if (opts.background === 'black') {
            ctx.fillStyle = '#000000'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
          }
          ctx.drawImage(img, 0, 0, pixelW, pixelH)
          cleanupBlob()

          canvas.toBlob(
            async (pngBlob) => {
              if (!pngBlob) {
                reject(new Error('PNG export failed'))
                return
              }
              try {
                await saveBlobWithFallback(pngBlob, filename, 'image/png')
                resolve()
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)))
              }
            },
            'image/png'
          )
        } catch (e) {
          cleanupBlob()
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })()
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not rasterize SVG'))
    }
    img.src = url
  })
}

function optionButtonClass(selected: boolean): string {
  return [
    'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
    selected
      ? 'border-primary bg-primary/10 font-medium text-foreground ring-1 ring-primary/40'
      : 'border-border text-foreground hover:bg-background',
  ].join(' ')
}

function MermaidDownloadModal({
  open,
  exporting,
  logicalW,
  logicalH,
  onClose,
  onExport,
}: {
  open: boolean
  exporting: ExportFileFormat | null
  /** Diagram size in user units (from viewBox); used to show export pixel dimensions. */
  logicalW: number
  logicalH: number
  onClose: () => void
  onExport: (opts: {
    format: ExportFileFormat
    background: ExportBackground
    sizeMultiplier: ExportSizeMultiplier
  }) => void
}) {
  const [format, setFormat] = useState<ExportFileFormat>('png')
  const [background, setBackground] = useState<ExportBackground>('transparent')
  const [sizeMultiplier, setSizeMultiplier] = useState<ExportSizeMultiplier>(4)

  useEffect(() => {
    if (!open) return
    setFormat('png')
    setBackground('transparent')
    setSizeMultiplier(4)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !exporting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose, exporting])

  if (!open) return null

  const busy = exporting !== null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mermaid-dl-title"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
          <h2 id="mermaid-dl-title" className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold text-foreground">
            Download diagram
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <span className="text-2xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="space-y-5 px-4 py-4">
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              File type
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                className={optionButtonClass(format === 'png')}
                onClick={() => setFormat('png')}
              >
                PNG
                <span className="mt-0.5 block text-[11px] font-normal text-foreground/65">Bitmap</span>
              </button>
              <button
                type="button"
                disabled={busy}
                className={optionButtonClass(format === 'svg')}
                onClick={() => setFormat('svg')}
              >
                SVG
                <span className="mt-0.5 block text-[11px] font-normal text-foreground/65">Vector</span>
              </button>
            </div>
          </fieldset>

          <fieldset className="min-w-0 space-y-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              Background
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { v: 'white' as const, label: 'White' },
                  { v: 'black' as const, label: 'Black' },
                  { v: 'transparent' as const, label: 'Transparent' },
                ] as const
              ).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  disabled={busy}
                  className={optionButtonClass(background === v)}
                  onClick={() => setBackground(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-foreground/55">
              Transparent keeps alpha in PNG and no backdrop rect in SVG.
            </p>
          </fieldset>

          <fieldset className="min-w-0 space-y-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              Size
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {SIZE_MULTIPLIERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  className={optionButtonClass(sizeMultiplier === value)}
                  onClick={() => setSizeMultiplier(value)}
                >
                  <span className="font-medium tabular-nums">{value}×</span>
                  <span className="mt-1 block min-w-0 text-center text-[11px] font-normal tabular-nums leading-snug text-foreground/70">
                    {formatPixelDimensions(logicalW, logicalH, value)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onExport({ format, background, sizeMultiplier })}
            className="min-h-[44px] rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Single diagram; theme follows `document.documentElement` dark class. */
export function MermaidBlock({ chart }: MermaidBlockProps) {
  const id = useId().replace(/:/g, '')
  const containerRef = useRef<HTMLDivElement>(null)
  const [diagramReady, setDiagramReady] = useState(false)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [modalLogicalSize, setModalLogicalSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  })
  const [exporting, setExporting] = useState<ExportFileFormat | null>(null)
  const { showAlert } = useAlertConfirm()

  useEffect(() => {
    let cancelled = false
    setDiagramReady(false)
    void (async () => {
      const mermaid = (await import('mermaid')).default
      const isDark = document.documentElement.classList.contains('dark')
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
      })
      if (!containerRef.current || cancelled) return
      const el = containerRef.current
      el.innerHTML = ''
      const rid = `mermaid-${id}-${Math.random().toString(36).slice(2, 9)}`
      try {
        const { svg } = await mermaid.render(rid, chart)
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg
          setDiagramReady(true)
        }
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML =
            '<p class="text-sm text-destructive">Could not render Mermaid diagram.</p>'
          setDiagramReady(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chart, id])

  const baseName = `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'export'}`

  const getSvgEl = useCallback((): SVGSVGElement | null => {
    const root = containerRef.current
    if (!root) return null
    const el = root.querySelector('svg')
    return el instanceof SVGSVGElement ? el : null
  }, [])

  const runExport = useCallback(
    async (opts: {
      format: ExportFileFormat
      background: ExportBackground
      sizeMultiplier: ExportSizeMultiplier
    }) => {
      const svgEl = getSvgEl()
      if (!svgEl) {
        showAlert('No diagram to save.', 'Export')
        return
      }
      setDownloadModalOpen(false)
      const ext = opts.format === 'png' ? 'png' : 'svg'
      setExporting(opts.format)
      try {
        if (opts.format === 'png') {
          await downloadPngFromSvg(svgEl, `${baseName}.${ext}`, {
            background: opts.background,
            sizeMultiplier: opts.sizeMultiplier,
          })
        } else {
          await downloadSvgFile(svgEl, `${baseName}.${ext}`, {
            background: opts.background,
            sizeMultiplier: opts.sizeMultiplier,
          })
        }
      } catch {
        showAlert('Could not save the diagram. Try another format or size.', 'Export failed')
      } finally {
        setExporting(null)
      }
    },
    [baseName, getSvgEl, showAlert]
  )

  const closeModal = useCallback(() => setDownloadModalOpen(false), [])

  return (
    <div className="group relative my-4 overflow-x-auto rounded-lg border border-border bg-background/50 p-3">
      <div ref={containerRef} />
      {diagramReady ? (
        <>
          <div className="pointer-events-none absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-150 print:hidden group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => {
                const svg = getSvgEl()
                if (svg) {
                  const d = parseSvgDimensions(svg)
                  setModalLogicalSize({ w: d.w, h: d.h })
                }
                setDownloadModalOpen(true)
              }}
              className="pointer-events-auto flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-border bg-card/95 text-foreground shadow-sm backdrop-blur-sm hover:bg-background disabled:opacity-50"
              title="Download diagram"
              aria-label="Download diagram"
            >
              {exporting !== null ? (
                <span className="text-[10px] font-medium">…</span>
              ) : (
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              )}
            </button>
          </div>
          <MermaidDownloadModal
            open={downloadModalOpen}
            exporting={exporting}
            logicalW={modalLogicalSize.w}
            logicalH={modalLogicalSize.h}
            onClose={closeModal}
            onExport={runExport}
          />
        </>
      ) : null}
    </div>
  )
}
