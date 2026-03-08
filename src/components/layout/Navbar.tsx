import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { ThemeToggle } from './ThemeToggle'

interface NavbarProps {
  onMenuClick?: () => void
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <>
      <nav className="flex h-14 min-h-[44px] items-center justify-between gap-2 border-b border-border bg-card px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
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
          <Link to="/" className="flex min-w-0 items-center gap-2 truncate text-base font-semibold text-foreground sm:text-lg">
            <img src="/icon.png" alt="" className="h-7 w-7 shrink-0 rounded object-contain sm:h-8 sm:w-8" />
            <span className="truncate">Automation Testing</span>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <span className="hidden text-sm text-foreground/80 sm:inline">{user?.username}</span>
          <ThemeToggle />
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[44px] min-w-[44px] rounded-lg px-3 py-2 text-sm text-foreground hover:bg-background sm:py-1.5"
          >
            Logout
          </button>
        </div>
      </nav>
    </>
  )
}
