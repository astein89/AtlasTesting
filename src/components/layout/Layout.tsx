import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Navbar } from './Navbar'
import { Sidebar } from './Sidebar'
import { useDateTimeConfig } from '../../hooks/useDateTimeConfig'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { showAlert } = useAlertConfirm()
  useDateTimeConfig()

  useEffect(() => {
    const state = location.state as { adminRequired?: boolean } | null
    if (state?.adminRequired) {
      showAlert('You need administrator rights to access that page.', 'Access denied')
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, location.pathname, navigate, showAlert])

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
        <main className="min-h-0 min-w-0 flex-1 overflow-auto px-3 pt-2 pb-3 sm:px-6 sm:pt-3 sm:pb-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
