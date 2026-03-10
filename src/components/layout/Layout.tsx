import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'
import { Sidebar } from './Sidebar'
import { useDateTimeConfig } from '../../hooks/useDateTimeConfig'

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useDateTimeConfig()

  return (
    <div className="flex h-screen flex-col min-h-0 bg-background text-foreground">
      <Navbar onMenuClick={() => setSidebarOpen((o) => !o)} />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-auto px-3 py-3 sm:px-6 sm:py-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
