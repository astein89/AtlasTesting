import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { adminPath, normalizeAppPathname } from '@/lib/appPaths'
import { getAdminerHref, resolveAdminerHref } from '@/lib/basePath'

const baseLink =
  'block rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px] flex items-center'

interface AdminModuleSidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export function AdminModuleSidebar({ isOpen = true, onClose }: AdminModuleSidebarProps) {
  const { pathname } = useLocation()
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const canAdminDb = useAuthStore((s) => s.hasPermission('admin.db'))
  const [adminerHref, setAdminerHref] = useState(() => getAdminerHref())
  const appPath = normalizeAppPathname(pathname)
  const onDbTablesPage = appPath === adminPath('db')

  useEffect(() => {
    if (!canAdminDb || !onDbTablesPage) return
    let cancelled = false
    const load = () => {
      void api
        .get<{ url: string | null }>('/settings/adminer-url')
        .then((r) => {
          if (!cancelled) setAdminerHref(resolveAdminerHref(r.data?.url ?? null))
        })
        .catch(() => {
          if (!cancelled) setAdminerHref(getAdminerHref())
        })
    }
    load()
    const onSaved = () => load()
    window.addEventListener('dc:adminer-url-saved', onSaved)
    return () => {
      cancelled = true
      window.removeEventListener('dc:adminer-url-saved', onSaved)
    }
  }, [canAdminDb, onDbTablesPage])

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-72 min-w-0 max-w-72 overflow-x-hidden border-r border-border bg-card p-4 pt-16 transition-transform md:relative md:pt-4 md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <nav className="flex min-w-0 flex-col gap-1 overflow-x-hidden">
        <NavLink
          to="/"
          end
          onClick={onClose}
          className={({ isActive }) =>
            `${baseLink} ${
              isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'
            }`
          }
        >
          Home
        </NavLink>
        <div className="my-2 border-t border-border" aria-hidden />
        {hasPermission('module.admin') && (
          <NavLink
            to={adminPath('status')}
            onClick={onClose}
            className={({ isActive }) =>
              `${baseLink} ${
                isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'
              }`
            }
          >
            Status
          </NavLink>
        )}
        {hasPermission('users.manage') && (
          <NavLink
            to={adminPath('users')}
            onClick={onClose}
            className={({ isActive }) =>
              `${baseLink} ${
                isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'
              }`
            }
          >
            Users
          </NavLink>
        )}
        {hasPermission('roles.manage') && (
          <NavLink
            to={adminPath('roles')}
            onClick={onClose}
            className={({ isActive }) =>
              `${baseLink} ${
                isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'
              }`
            }
          >
            Roles
          </NavLink>
        )}
        {hasPermission('settings.access') && (
          <NavLink
            to={adminPath('settings')}
            onClick={onClose}
            className={({ isActive }) =>
              `${baseLink} ${
                isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'
              }`
            }
          >
            Settings
          </NavLink>
        )}
        {hasPermission('admin.db') && (
          <div className="flex flex-col gap-0.5">
            <NavLink
              to={adminPath('db')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'
                }`
              }
            >
              DB tables
            </NavLink>
            {onDbTablesPage ? (
              <div className="ml-2 border-l border-border pl-3">
                <a
                  href={adminerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className={`${baseLink} text-foreground/90 hover:bg-background`}
                  title="Adminer web console on this server (install per docs; opens in a new tab)"
                >
                  Adminer
                </a>
              </div>
            ) : null}
          </div>
        )}
      </nav>
    </aside>
  )
}
