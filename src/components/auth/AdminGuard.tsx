import { useLocation, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

export function AdminGuard({ children }: { children?: React.ReactNode }) {
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const location = useLocation()

  if (!isAdmin) {
    return <Navigate to="/" replace state={{ adminRequired: true, from: location.pathname }} />
  }

  return children ? <>{children}</> : <Outlet />
}
