import { publicAsset } from '@/lib/basePath'
import { applySiteIconsToDocument } from '@/lib/documentIcons'
import { uploadsUrl } from '@/lib/uploadsUrl'
import { useSiteBrandingStore } from '@/store/siteBrandingStore'

/** Apply favicon / apple-touch links from public `GET /home` fields (or saved config). */
export function applyIconsFromHomeBrandingPayload(data: {
  siteFaviconPath?: string | null
  homeBrandingRevision?: number | null
}) {
  useSiteBrandingStore.getState().setFromHomePayload(data)
  const rev = typeof data.homeBrandingRevision === 'number' ? data.homeBrandingRevision : 0
  const p = typeof data.siteFaviconPath === 'string' ? data.siteFaviconPath.trim() : ''
  const href = p ? uploadsUrl(p, rev) : publicAsset('icon.png')
  const iconType = p.toLowerCase().endsWith('.svg') ? ('image/svg+xml' as const) : ('image/png' as const)
  applySiteIconsToDocument(href, p ? iconType : 'image/png')
}
