import { Suspense, useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LoginModal } from '../auth/LoginModal'
import { AmrAttentionBanner } from '../amr/AmrAttentionBanner'
import { AmrPresenceWarningBanner } from '../amr/AmrPresenceWarningBanner'
import { Navbar } from './Navbar'
import { Sidebar } from './Sidebar'
import { AdminModuleSidebar } from './AdminModuleSidebar'
import { FilesModuleHostProvider } from '../../contexts/FilesModuleHostContext'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'
import { useLoginModalStore } from '../../store/loginModalStore'

interface LayoutProps {
  /** When false, only the top bar + main content (e.g. home hub). */
  showSidebar?: boolean
}

export function Layout({ showSidebar = true }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const inAdminModule = location.pathname.startsWith('/admin')
  const navigate = useNavigate()
  const { showAlert } = useAlertConfirm()
  const openLogin = useLoginModalStore((s) => s.openLogin)

  useEffect(() => {
    const state = location.state as { adminRequired?: boolean } | null
    if (state?.adminRequired) {
      showAlert('You need administrator rights to access that page.', 'Access denied')
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, location.pathname, navigate, showAlert])

  useEffect(() => {
    const st = location.state as { openLoginModal?: boolean; loginReturnTo?: string } | undefined
    if (!st?.openLoginModal) return
    openLogin({ returnTo: st.loginReturnTo ?? null })
    const { openLoginModal: _o, loginReturnTo: _r, ...rest } = st as Record<string, unknown>
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: Object.keys(rest).length ? (rest as object) : undefined }
    )
  }, [location.state, location.pathname, location.search, location.hash, navigate, openLogin])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('login') !== '1') return
    openLogin()
    params.delete('login')
    const q = params.toString()
    navigate(
      { pathname: location.pathname, search: q ? `?${q}` : '', hash: location.hash },
      { replace: true, state: location.state }
    )
  }, [location.search, location.pathname, location.hash, navigate, openLogin, location.state])

  return (
    <div className="flex h-screen min-h-0 w-full min-w-0 max-w-[100%] flex-col overflow-x-hidden bg-background text-foreground">
      <Navbar onMenuClick={showSidebar ? () => setSidebarOpen((o) => !o) : undefined} />
      <AmrPresenceWarningBanner />
      <AmrAttentionBanner />
      <FilesModuleHostProvider>
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden">
          {showSidebar && (
            <>
              {inAdminModule ? (
                <AdminModuleSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
              ) : (
                <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
              )}
              {sidebarOpen && (
                <div
                  className="fixed inset-0 z-40 bg-black/50 md:hidden"
                  onClick={() => setSidebarOpen(false)}
                  aria-hidden
                />
              )}
            </>
          )}
          <main className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-auto px-3 pt-2 pb-3 sm:px-6 sm:pt-3 sm:pb-4">
            <Suspense
              fallback={
                <div className="flex min-h-[12rem] items-center justify-center text-foreground/60">
                  <span className="text-sm">Loading this page…</span>
                </div>
              }
            >
              <div className="relative flex w-full min-w-0 max-w-full min-h-0 flex-1 flex-col">
                <Outlet />
              </div>
            </Suspense>
          </main>
        </div>
      </FilesModuleHostProvider>
      <LoginModal />
    </div>
  )
}
