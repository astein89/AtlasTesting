import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useHomePageEditStore } from '../../store/homePageEditStore'
import { useLoginModalStore } from '../../store/loginModalStore'
import { AMR_PREFIX, amrPath } from '@/lib/appPaths'
import { useAmrMissionNewModal } from '@/contexts/AmrMissionNewModalContext'
import { publicAsset } from '../../lib/basePath'
import { uploadsUrl } from '../../lib/uploadsUrl'
import { useSiteBrandingStore } from '../../store/siteBrandingStore'
import { ThemeToggle } from './ThemeToggle'

interface NavbarProps {
  onMenuClick?: () => void
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const canEditHome = useAuthStore((s) => s.hasPermission('home.edit'))
  const canManageLinks = useAuthStore((s) => s.hasPermission('links.edit'))
  const canNewAmrMission = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const setHomeEditorOpen = useHomePageEditStore((s) => s.setEditorOpen)
  const openLoginModal = useLoginModalStore((s) => s.openLogin)
  const onHomePage = pathname === '/' || pathname === ''
  const onLinksArea = pathname === '/links' || pathname === '/links/'
  const onAmrModule = pathname.startsWith(AMR_PREFIX)
  const amrNewMissionModal = useAmrMissionNewModal()
  const navbarIconSrc = useSiteBrandingStore((s) => {
    const p = s.siteFaviconPath?.trim()
    return p ? uploadsUrl(p, s.homeBrandingRevision) : publicAsset('icon.png')
  })

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const newMissionLinkClass =
    'min-h-[44px] shrink-0 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90'

  return (
    <>
      <nav className="border-b border-border bg-card">
        <div className="flex h-14 min-h-[44px] items-center justify-between gap-2 px-3 sm:px-4">
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
            <Link
              to="/"
              className="flex min-w-0 items-center gap-2 truncate text-base font-semibold text-foreground sm:text-lg"
            >
              <img src={navbarIconSrc} alt="" className="h-7 w-7 shrink-0 rounded object-contain sm:h-8 sm:w-8" />
              <span className="truncate">DC Automation</span>
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {canManageLinks && (onHomePage || onLinksArea) ? (
              <Link
                to="/links?manage=1"
                className="min-h-[44px] shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium text-foreground hover:bg-background/80 sm:px-3 sm:text-sm"
              >
                <span className="sm:hidden">Links</span>
                <span className="hidden sm:inline">Manage links</span>
              </Link>
            ) : null}
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
            {canNewAmrMission && onAmrModule ? (
              amrNewMissionModal ? (
                <button
                  type="button"
                  onClick={() => amrNewMissionModal.openNewMission()}
                  className={`hidden sm:inline-flex ${newMissionLinkClass}`}
                >
                  New mission
                </button>
              ) : (
                <Link to={amrPath('missions/new')} className={`hidden sm:inline-flex ${newMissionLinkClass}`}>
                  New mission
                </Link>
              )
            ) : null}
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
        </div>
        {canNewAmrMission && onAmrModule ? (
          <div className="border-t border-border px-3 pb-2 pt-2 sm:hidden">
            {amrNewMissionModal ? (
              <button
                type="button"
                onClick={() => amrNewMissionModal.openNewMission()}
                className={`flex w-full ${newMissionLinkClass}`}
              >
                New mission
              </button>
            ) : (
              <Link to={amrPath('missions/new')} className={`flex w-full ${newMissionLinkClass}`}>
                New mission
              </Link>
            )}
          </div>
        ) : null}
      </nav>
    </>
  )
}
