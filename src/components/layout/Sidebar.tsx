import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

const baseLink =
  'block rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px] flex items-center'

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const isAdmin = useAuthStore((s) => s.isAdmin())

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-56 border-r border-border bg-card p-4 pt-16 transition-transform md:relative md:pt-4 md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <nav className="flex flex-col gap-1">
        <NavLink
          to="/"
          onClick={onClose}
          className={({ isActive }) =>
            `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/test-plans"
          onClick={onClose}
          className={({ isActive }) =>
            `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Test Plans
        </NavLink>
        <NavLink
          to="/results"
          onClick={onClose}
          className={({ isActive }) =>
            `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Results
        </NavLink>
        <NavLink
          to="/settings"
          onClick={onClose}
          className={({ isActive }) =>
            `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Settings
        </NavLink>
        {isAdmin && (
          <>
            <div className="my-2 border-t border-border" />
            <NavLink
              to="/fields"
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
              }
            >
              Data Fields
            </NavLink>
            <NavLink
              to="/users"
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
              }
            >
              Users
            </NavLink>
            <NavLink
              to="/admin/db"
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
              }
            >
              DB Tables
            </NavLink>
          </>
        )}
      </nav>
    </aside>
  )
}
