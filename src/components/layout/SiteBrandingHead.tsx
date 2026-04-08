import { useEffect } from 'react'
import { api, isAbortLikeError } from '@/api/client'
import { applyIconsFromHomeBrandingPayload } from '@/lib/homeBrandingIcons'

/** One-time (per mount) fetch of public home config to set tab / PWA icons from uploaded favicon when configured. */
export function SiteBrandingHead() {
  useEffect(() => {
    const ac = new AbortController()
    api
      .get<unknown>('/home', { signal: ac.signal })
      .then((r) => {
        const d = r.data as {
          siteFaviconPath?: string | null
          homeBrandingRevision?: number | null
        }
        applyIconsFromHomeBrandingPayload(d)
      })
      .catch((e) => {
        if (!isAbortLikeError(e)) {
          /* keep built-in defaults from index.html / main */
        }
      })
    return () => ac.abort()
  }, [])

  return null
}
