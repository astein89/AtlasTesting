import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

export function AdminGuard({ children }: { children?: React.ReactNode }) {
  const isAdmin = useAuthStore((s) => s.isAdmin())

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  return children ? <>{children}</> : <Outlet />
}
