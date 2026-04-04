/**
 * Resolve site favicons for home link cards.
 * External http(s) URLs try several endpoints (Google cache, DuckDuckGo, /favicon.ico); in-app paths use the app icon.
 */

import { publicAsset } from './basePath'

const FAVICON_SZ = 96

/**
 * Google / DuckDuckGo favicon APIs 404 for localhost, loopback, and LAN IPs — avoid useless
 * requests (and noisy DevTools) by resolving from the site only.
 */
export function shouldSkipThirdPartyFaviconLookup(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h === '::1') return true
  if (h.startsWith('127.')) return true
  if (h.startsWith('10.')) return true
  if (h.startsWith('192.168.')) return true
  const m = /^172\.(\d+)\./.exec(h)
  if (m) {
    const n = Number(m[1])
    if (n >= 16 && n <= 31) return true
  }
  if (h.endsWith('.local')) return true
  if (h.includes(':')) {
    const v6 = h.toLowerCase()
    if (v6 === '::1' || v6.startsWith('fe80:') || v6.startsWith('fc00:') || v6.startsWith('fd'))
      return true
  }
  return false
}

export function hostnameForHttpUrl(href: string): string | null {
  const t = href.trim()
  if (!/^https?:\/\//i.test(t)) return null
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.replace(/\.$/, '')
  if (!host) return null
  return host
}

/**
 * URLs to try in order for an <img> (onError → next). Helps when one provider is blocked (e.g. LAN Pi without Google).
 */
export function externalFaviconCandidateUrls(href: string): string[] {
  const t = href.trim()
  const host = hostnameForHttpUrl(t)
  if (!host) return []
  const skipRemote = shouldSkipThirdPartyFaviconLookup(host)
  const google = `https://www.google.com/s2/favicons?sz=${FAVICON_SZ}&domain=${encodeURIComponent(host)}`
  const ddg = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`
  let otherOriginFavicon: string | undefined
  let appIconPng: string | undefined
  let appIconSvg: string | undefined
  try {
    const u = new URL(t)
    const sameOrigin = typeof window !== 'undefined' && u.origin === window.location.origin
    if (sameOrigin) {
      appIconPng = publicAsset('icon.png')
      appIconSvg = publicAsset('icon.svg')
    } else {
      otherOriginFavicon = `${u.protocol}//${u.host}/favicon.ico`
    }
  } catch {
    // ignore
  }
  const remote = skipRemote ? [] : [google, ddg]
  const list = [...remote, otherOriginFavicon, appIconPng, appIconSvg].filter((x): x is string => !!x)
  return [...new Set(list)]
}

export function faviconUrlForHostname(hostname: string, size = 96): string | null {
  const h = hostname.trim().replace(/\.$/, '')
  if (!h) return null
  if (shouldSkipThirdPartyFaviconLookup(h)) return null
  const s = Math.min(128, Math.max(16, size))
  return `https://www.google.com/s2/favicons?sz=${s}&domain=${encodeURIComponent(h)}`
}

/** First candidate (Google); prefer `externalFaviconCandidateUrls` for resilient loading. */
export function faviconUrlForHref(href: string): string | null {
  const urls = externalFaviconCandidateUrls(href)
  return urls[0] ?? null
}
