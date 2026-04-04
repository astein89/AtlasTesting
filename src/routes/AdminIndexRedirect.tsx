import { Navigate } from 'react-router-dom'
import { firstAccessibleAdminPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'

/** `/admin` has no landing page; send users to the first section they can use. */
export function AdminIndexRedirect() {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const target = firstAccessibleAdminPath(hasPermission)
  if (!target) {
    return <Navigate to="/" replace />
  }
  return <Navigate to={target} replace />
}
