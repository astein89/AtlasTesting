import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { publicAsset } from './lib/basePath'
import './index.css'

const basePath = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')

/** Align &lt;head&gt; icons with Vite base (subpath deploys). Tab icon: PNG only — no SVG &lt;link rel="icon"&gt;. */
function syncDocumentIcons() {
  const pngHref = publicAsset('icon.png')
  for (const el of document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')) {
    el.remove()
  }
  const pngIcons = document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"][type="image/png"]')
  if (pngIcons.length === 0) {
    const a = document.createElement('link')
    a.rel = 'icon'
    a.type = 'image/png'
    a.setAttribute('sizes', 'any')
    a.href = pngHref
    document.head.appendChild(a)
    const b = document.createElement('link')
    b.rel = 'icon'
    b.type = 'image/png'
    b.setAttribute('sizes', '32x32')
    b.href = pngHref
    document.head.appendChild(b)
  } else {
    pngIcons.forEach((el) => {
      el.href = pngHref
    })
  }
  let apple = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (!apple) {
    apple = document.createElement('link')
    apple.rel = 'apple-touch-icon'
    document.head.appendChild(apple)
  }
  apple.href = pngHref
  let shortcut = document.head.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]')
  if (!shortcut) {
    shortcut = document.createElement('link')
    shortcut.rel = 'shortcut icon'
    shortcut.type = 'image/png'
    document.head.appendChild(shortcut)
  }
  shortcut.href = pngHref
}

syncDocumentIcons()

if (import.meta.env.DEV) {
  document.title = 'DC Automation — dev'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter
      basename={basePath}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
