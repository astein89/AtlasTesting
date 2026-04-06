import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

export function AuthGuard({ children }: { children?: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const initializing = useAuthStore((s) => s.initializing)
  const location = useLocation()

  /** Only block the shell when we still don’t know if there’s a session. If `user` is already
   * rehydrated, allow navigation while token refresh runs (AuthInit sets `initializing` true).
   * Otherwise SPA navigations from `/` to protected routes stay on a blank loading screen. */
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
