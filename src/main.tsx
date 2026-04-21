import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { createAppBrowserRouter } from './App'
import { publicAsset } from './lib/basePath'
import { applySiteIconsToDocument } from './lib/documentIcons'
import './lib/mdEditorRtConfig'
import './index.css'

const basePath = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')

applySiteIconsToDocument(publicAsset('icon.png'))

if (import.meta.env.DEV) {
  document.title = 'DC Automation — dev'
}

const router = createAppBrowserRouter(basePath)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>,
)
