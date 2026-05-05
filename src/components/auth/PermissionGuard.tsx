import { Navigate, useLocation } from 'react-router-dom'
import { AMR_PREFIX, FILES_PREFIX, firstAccessibleAdminPath, testingPath, WIKI_PREFIX } from '@/lib/appPaths'
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
    return <Navigate to={testingPath('test-plans')} replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.locations')) {
    return <Navigate to="/locations" replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.wiki')) {
    return <Navigate to={WIKI_PREFIX} replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.files')) {
    return <Navigate to={FILES_PREFIX} replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.amr')) {
    return <Navigate to={AMR_PREFIX} replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.admin')) {
    const adminTarget = firstAccessibleAdminPath(hasPermission) ?? '/'
    return <Navigate to={adminTarget} replace state={{ forbidden: true, from }} />
  }
  if (hasPermission('module.home')) {
    return <Navigate to="/" replace state={{ forbidden: true, from }} />
  }
  return <Navigate to="/" replace state={{ forbidden: true, from }} />
}
