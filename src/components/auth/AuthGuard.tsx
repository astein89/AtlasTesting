import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

export function AuthGuard({ children }: { children?: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const initializing = useAuthStore((s) => s.initializing)
  const location = useLocation()

  /** `accessToken` is not persisted; after reload we have user + refreshToken only until AuthInit refreshes. */
  if (user && refreshToken && !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-foreground/60">Loading...</p>
      </div>
    )
  }

  /** Cold start before persist rehydration (no session shape yet). */
  if (initializing && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-foreground/60">Loading...</p>
      </div>
    )
  }

  if (!user) {
    const loginReturnTo = `${location.pathname}${location.search}${location.hash}`
    return (
      <Navigate to="/" replace state={{ openLoginModal: true, loginReturnTo }} />
    )
  }

  return children ? <>{children}</> : <Outlet />
}
