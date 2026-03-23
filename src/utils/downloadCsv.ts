import axios from 'axios'
import { api } from '../api/client'

function parseFilenameFromContentDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback
  const star = header.match(/filename\*=UTF-8''([^;\s]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, ''))
    } catch {
      return fallback
    }
  }
  const m = header.match(/filename="([^"]+)"/i) ?? header.match(/filename=([^;\s]+)/i)
  return m ? m[1].trim().replace(/"/g, '') : fallback
}

/**
 * GET a CSV from the API with auth headers and trigger a browser download.
 * Surfaces JSON `{ error }` bodies (4xx/5xx) as thrown Error messages.
 */
export async function downloadCsvFromApi(
  path: string,
  options: { params?: Record<string, string>; filenameFallback?: string }
): Promise<void> {
  const filenameFallback = options.filenameFallback ?? 'export.csv'
  try {
    const res = await api.get(path, {
      params: options.params,
      responseType: 'blob',
    })
    const blob = res.data as Blob
    const ct = String(res.headers['content-type'] ?? '')
    if (ct.includes('application/json')) {
      const text = await blob.text()
      let msg = 'Export failed'
      try {
        const j = JSON.parse(text) as { error?: string }
        if (j.error) msg = j.error
      } catch {
        // ignore
      }
      throw new Error(msg)
    }
    const filename = parseFilenameFromContentDisposition(
      res.headers['content-disposition'],
      filenameFallback
    )
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
      const text = await err.response.data.text()
      let msg = 'Export failed'
      try {
        const j = JSON.parse(text) as { error?: string }
        if (j.error) msg = j.error
      } catch {
        // ignore
      }
      throw new Error(msg)
    }
    throw err
  }
}
