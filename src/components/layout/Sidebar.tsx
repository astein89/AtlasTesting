import { NavLink, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { testingPath, locationsPath } from '../../lib/appPaths'

const baseLink =
  'block rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px] flex items-center'

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const location = useLocation()
  const inLocations = location.pathname.startsWith('/locations')
  const inTesting = location.pathname.startsWith('/testing')

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-56 border-r border-border bg-card p-4 pt-16 transition-transform md:relative md:pt-4 md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <nav className="flex flex-col gap-1">
        {(inTesting || inLocations) && (
          <NavLink
            to="/"
            end
            onClick={onClose}
            className={({ isActive }) =>
              `${baseLink} ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-background'
              }`
            }
          >
            Home
          </NavLink>
        )}
        {inTesting && (
          <>
            <div className="my-2 border-t border-border" aria-hidden />
            <NavLink
              to={testingPath('test-plans')}
              end
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Testing
            </NavLink>
            <NavLink
              to={testingPath('results')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Results
            </NavLink>
          </>
        )}
        {inTesting && hasPermission('fields.manage') && (
          <>
            <div className="my-2 border-t border-border" />
            <NavLink
              to={testingPath('fields')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Data Fields
            </NavLink>
          </>
        )}
        {hasPermission('module.locations') && inLocations && (
          <>
            <div className="my-2 border-t border-border" />
            <NavLink
              to={locationsPath()}
              end
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Locations
            </NavLink>
            <div className="my-2 border-t border-border" aria-hidden />
            <NavLink
              to={locationsPath('schemas')}
              end
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Schema
            </NavLink>
          </>
        )}
      </nav>
    </aside>
  )
}
