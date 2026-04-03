import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useHomePageEditStore } from '../../store/homePageEditStore'
import { useLoginModalStore } from '../../store/loginModalStore'
import { getBasePath } from '../../lib/basePath'
import { ThemeToggle } from './ThemeToggle'

interface NavbarProps {
  onMenuClick?: () => void
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const canEditHome = useAuthStore((s) => s.hasPermission('home.edit'))
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const setHomeEditorOpen = useHomePageEditStore((s) => s.setEditorOpen)
  const openLoginModal = useLoginModalStore((s) => s.openLogin)
  const onHomePage = pathname === '/' || pathname === ''

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <>
      <nav className="flex h-14 min-h-[44px] items-center justify-between gap-2 border-b border-border bg-card px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-background md:hidden"
              aria-label="Open menu"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <Link to="/" className="flex min-w-0 items-center gap-2 truncate text-base font-semibold text-foreground sm:text-lg">
            <img src={`${getBasePath()}/icon.png`} alt="" className="h-7 w-7 shrink-0 rounded object-contain sm:h-8 sm:w-8" />
            <span className="truncate">DC Automation</span>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {canEditHome && onHomePage && (
            <button
              type="button"
              onClick={() => setHomeEditorOpen(true)}
              className="min-h-[44px] shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium text-foreground hover:bg-background/80 sm:px-3 sm:text-sm"
            >
              <span className="sm:hidden">Edit</span>
              <span className="hidden sm:inline">Edit home page</span>
            </button>
          )}
          {user ? (
            <span className="hidden text-sm text-foreground/80 sm:inline">{user.username}</span>
          ) : null}
          <ThemeToggle />
          {user ? (
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[44px] min-w-[44px] rounded-lg px-3 py-2 text-sm text-foreground hover:bg-background sm:py-1.5"
            >
              Logout
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openLoginModal()}
              className="min-h-[44px] shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-background/80 sm:py-1.5"
            >
              Login
            </button>
          )}
        </div>
      </nav>
    </>
  )
}
