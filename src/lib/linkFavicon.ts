/**
 * Resolve site favicons for home link cards.
 * External http(s) URLs use a third-party favicon lookup (by host); in-app paths use the app icon.
 */

export function hostnameForHttpUrl(href: string): string | null {
  const t = href.trim()
  if (!/^https?:\/\//i.test(t)) return null
  try {
    const host = new URL(t).hostname
    return host || null
  } catch {
    return null
  }
}

/** Google favicon cache; avoids CORS issues when loading site icons in the browser. */
export function faviconUrlForHostname(hostname: string, size = 96): string {
  const s = Math.min(128, Math.max(16, size))
  return `https://www.google.com/s2/favicons?sz=${s}&domain=${encodeURIComponent(hostname)}`
}

export function faviconUrlForHref(href: string): string | null {
  const host = hostnameForHttpUrl(href)
  if (!host) return null
  return faviconUrlForHostname(host)
}
