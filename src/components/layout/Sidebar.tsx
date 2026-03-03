import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

const baseLink =
  'block rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px] flex items-center'

export function Sidebar() {
  const isAdmin = useAuthStore((s) => s.isAdmin())

  return (
    <aside className="w-56 border-r border-border bg-card p-4">
      <nav className="flex flex-col gap-1">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/test-plans"
          className={({ isActive }) =>
            `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Test Plans
        </NavLink>
        <NavLink
          to="/export"
          className={({ isActive }) =>
            `${baseLink} ml-4 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Export
        </NavLink>
        <NavLink
          to="/results"
          className={({ isActive }) =>
            `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
          }
        >
          Results
        </NavLink>
        {isAdmin && (
          <>
            <div className="my-2 border-t border-border" />
            <NavLink
              to="/fields"
              className={({ isActive }) =>
                `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
              }
            >
              Data Fields
            </NavLink>
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `${baseLink} ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'}`
              }
            >
              Users
            </NavLink>
            <NavLink
              to="/admin/db"
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
