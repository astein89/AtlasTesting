import { getBasePath } from '@/lib/basePath'

/** Root-relative URL for a file under `uploads/` (served at `/api/uploads/…`). */
export function uploadsUrl(relativePath: string, cacheRevision?: number): string {
  const name = relativePath.replace(/^\/+/, '').replace(/^api\/uploads\/?/i, '')
  const base = getBasePath()
  const u = `${base}/api/uploads/${name}`
  if (cacheRevision != null && Number.isFinite(cacheRevision)) {
    return `${u}?v=${cacheRevision}`
  }
  return u
}
