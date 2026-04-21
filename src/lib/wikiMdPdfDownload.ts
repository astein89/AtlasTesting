import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

const PDF_MARGIN_MM = 12
const JPEG_QUALITY = 0.92

/**
 * Renders a preview DOM node to a multi-page A4 PDF (not the browser print dialog).
 */
export async function downloadPreviewElementAsPdf(
  source: HTMLElement,
  filename: string
): Promise<void> {
  const canvas = await html2canvas(source, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: source.scrollWidth,
    windowHeight: source.scrollHeight,
  })

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const contentWidth = pageWidth - PDF_MARGIN_MM * 2
  const pageContentHeight = pageHeight - PDF_MARGIN_MM * 2

  const totalHeightMm = (canvas.height * contentWidth) / canvas.width
  if (totalHeightMm <= 0) {
    pdf.save(safePdfFileName(filename))
    return
  }

  let offsetMm = 0

  while (offsetMm < totalHeightMm - 0.1) {
    const sliceMm = Math.min(pageContentHeight, totalHeightMm - offsetMm)
    const offsetPx = (offsetMm / totalHeightMm) * canvas.height
    const slicePx = (sliceMm / totalHeightMm) * canvas.height

    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = Math.max(1, Math.round(slicePx))
    const ctx = slice.getContext('2d')
    if (!ctx) break
    ctx.drawImage(
      canvas,
      0,
      offsetPx,
      canvas.width,
      slicePx,
      0,
      0,
      canvas.width,
      slicePx
    )
    const chunkData = slice.toDataURL('image/jpeg', JPEG_QUALITY)
    const drawH = sliceMm
    pdf.addImage(chunkData, 'JPEG', PDF_MARGIN_MM, PDF_MARGIN_MM, contentWidth, drawH)
    offsetMm += sliceMm
    if (offsetMm < totalHeightMm - 0.1) {
      pdf.addPage()
    }
  }

  pdf.save(safePdfFileName(filename))
}

function safePdfFileName(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'document'
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`
}

/**
 * Target: root `id` on the md-editor-rt {@link MdPreview} wrapper (the outer `.md-editor` node).
 */
export function getMdPreviewArticleEl(editorRootId: string): HTMLElement | null {
  const root = document.getElementById(editorRootId)
  if (!root) return null
  const preview = root.querySelector('.md-editor-preview') as HTMLElement | null
  return preview ?? root
}
