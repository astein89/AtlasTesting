import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { ThemeToggle } from './ThemeToggle'
import { ChangePasswordModal } from '../auth/ChangePasswordModal'

export function Navbar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [showChangePassword, setShowChangePassword] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <>
      <nav className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <Link to="/" className="text-lg font-semibold text-foreground">
          Atlas Testing
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground/80">{user?.username}</span>
          <button
            type="button"
            onClick={() => setShowChangePassword(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            Change password
          </button>
          <ThemeToggle />
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            Logout
          </button>
        </div>
      </nav>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </>
  )
}
