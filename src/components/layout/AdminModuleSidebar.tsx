import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { adminPath } from '@/lib/appPaths'

const baseLink =
  'block rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px] flex items-center'

interface AdminModuleSidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export function AdminModuleSidebar({ isOpen = true, onClose }: AdminModuleSidebarProps) {
  const hasPermission = useAuthStore((s) => s.hasPermission)

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-56 border-r border-border bg-card p-4 pt-16 transition-transform md:relative md:pt-4 md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <nav className="flex flex-col gap-1">
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
        )}
      </nav>
    </aside>
  )
}
