type FaviconType = 'image/png' | 'image/svg+xml'

/**
 * Updates &lt;head&gt; link tags for the site tab icon and Apple touch icon.
 * Keeps paths consistent with subpath deploys (`BASE_URL`).
 */
export function applySiteIconsToDocument(href: string, iconType: FaviconType = 'image/png') {
  for (const el of document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"], link[rel="icon"][type="image/png"]'
  )) {
    el.remove()
  }
  if (iconType === 'image/png') {
    const a = document.createElement('link')
    a.rel = 'icon'
    a.type = 'image/png'
    a.setAttribute('sizes', 'any')
    a.href = href
    document.head.appendChild(a)
    const b = document.createElement('link')
    b.rel = 'icon'
    b.type = 'image/png'
    b.setAttribute('sizes', '32x32')
    b.href = href
    document.head.appendChild(b)
  } else {
    const a = document.createElement('link')
    a.rel = 'icon'
    a.type = 'image/svg+xml'
    a.href = href
    document.head.appendChild(a)
  }
  let apple = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (!apple) {
    apple = document.createElement('link')
    apple.rel = 'apple-touch-icon'
    document.head.appendChild(apple)
  }
  apple.href = href
  let shortcut = document.head.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]')
  if (!shortcut) {
    shortcut = document.createElement('link')
    shortcut.rel = 'shortcut icon'
    document.head.appendChild(shortcut)
  }
  shortcut.type = iconType
  shortcut.href = href
}
