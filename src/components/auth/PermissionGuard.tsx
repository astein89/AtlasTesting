import { Navigate, useLocation } from 'react-router-dom'
import { adminPath, testingPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'

type Props = {
  permission: string
  children: React.ReactNode
}

/** Redirects if the user lacks the module permission (avoids looping on `/`). */
export function PermissionGuard({ permission, children }: Props) {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const location = useLocation()

  if (hasPermission(permission)) {
    return <>{children}</>
  }

  const from = location.pathname
  if (hasPermission('module.testing')) {
    return <Navigate to={testingPath()} replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.locations')) {
    return <Navigate to="/locations" replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.admin')) {
    return <Navigate to={adminPath()} replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.home')) {
    return <Navigate to="/" replace state={{ forbidden: true, from }} />
  }
  return <Navigate to="/" replace state={{ forbidden: true, from }} />
}
