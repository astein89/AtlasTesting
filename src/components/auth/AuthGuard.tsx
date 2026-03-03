import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

export function AuthGuard({ children }: { children?: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const initializing = useAuthStore((s) => s.initializing)

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-foreground/60">Loading...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children ? <>{children}</> : <Outlet />
}
