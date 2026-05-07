import { NavLink, useLocation } from 'react-router-dom'
import { WikiSidebarNav } from '../wiki/WikiSidebarNav'
import { useAuthStore } from '../../store/authStore'
import { testingPath, locationsPath, amrPath } from '../../lib/appPaths'
import { FilesSidebarTree } from '../files/FilesSidebarTree'

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
  const inWiki = location.pathname.startsWith('/wiki')
  const inFiles = location.pathname.startsWith('/files')
  const inAmr = location.pathname.startsWith('/amr')
  const pathNorm = location.pathname.replace(/\/$/, '') || '/'
  const missionsRoot = amrPath('missions')
  const inMissionsSection = pathNorm === missionsRoot || pathNorm.startsWith(`${missionsRoot}/`)
  const standsRoot = amrPath('stands')
  const inStandsSection = pathNorm === standsRoot || pathNorm.startsWith(`${standsRoot}/`)
  const wikiOrFilesWide = inWiki || (inFiles && hasPermission('module.files'))
  /** AMR nav is short labels — use a slimmer rail than the default 18rem (`w-72`) module sidebar. */
  const amrSidebarWide =
    'w-[min(14rem,calc(100vw-1rem))] max-w-[min(14rem,calc(100vw-1rem))] md:w-[min(14rem,calc(100vw-1rem))] md:max-w-[min(14rem,calc(100vw-1rem))]'

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex min-h-0 min-w-0 flex-col overflow-x-hidden border-r border-border bg-card p-4 pt-16 transition-transform md:relative md:self-stretch md:pt-4 md:translate-x-0 ${
        wikiOrFilesWide
          ? 'w-[min(16.5rem,calc(100vw-1rem))] max-w-[min(16.5rem,calc(100vw-1rem))] md:w-[min(16.5rem,calc(100vw-1rem))] md:max-w-[min(16.5rem,calc(100vw-1rem))]'
          : inAmr
            ? amrSidebarWide
            : 'w-72 max-w-72 md:w-72 md:max-w-72'
      } ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <nav className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden">
        {(inTesting || inLocations || inWiki || inFiles || inAmr) && (
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
              Test Plans
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
        {hasPermission('module.wiki') && inWiki && (
          <>
            <div className="my-2 border-t border-border" aria-hidden />
            <WikiSidebarNav onNavigate={onClose} />
          </>
        )}
        {hasPermission('module.files') && inFiles && (
          <>
            <div className="my-2 border-t border-border" aria-hidden />
            <FilesSidebarTree onNavigate={onClose} />
          </>
        )}
        {hasPermission('module.amr') && inAmr && (
          <>
            <div className="my-2 border-t border-border" aria-hidden />
            <NavLink
              to={amrPath('dashboard')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to={amrPath('missions')}
              onClick={onClose}
              className={() =>
                `${baseLink} ${
                  inMissionsSection
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Missions
            </NavLink>
            {inMissionsSection ? (
              <NavLink
                to={amrPath('missions', 'templates')}
                onClick={onClose}
                className={({ isActive }) =>
                  `${baseLink} ml-2 border-l border-border/70 pl-4 ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-background'
                  }`
                }
              >
                Templates
              </NavLink>
            ) : null}
            <NavLink
              to={amrPath('robots')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Robots
            </NavLink>
            <NavLink
              to={amrPath('containers')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Containers
            </NavLink>
            <NavLink
              to={amrPath('logs')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Logs
            </NavLink>
            <NavLink
              to={amrPath('stands')}
              onClick={onClose}
              end
              className={() =>
                `${baseLink} ${
                  inStandsSection
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Stands
            </NavLink>
            {inStandsSection ? (
              <NavLink
                to={amrPath('stands', 'groups')}
                onClick={onClose}
                className={({ isActive }) =>
                  `${baseLink} ml-2 border-l border-border/70 pl-4 ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-background'
                  }`
                }
              >
                Groups
              </NavLink>
            ) : null}
            <NavLink
              to={amrPath('settings')}
              onClick={onClose}
              className={({ isActive }) =>
                `${baseLink} ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-background'
                }`
              }
            >
              Settings
            </NavLink>
            {(hasPermission('amr.tools.dev') || hasPermission('amr.settings')) && (
              <NavLink
                to={amrPath('tools/api-playground')}
                onClick={onClose}
                className={({ isActive }) =>
                  `${baseLink} ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-background'
                  }`
                }
              >
                API Playground
              </NavLink>
            )}
          </>
        )}
      </nav>
    </aside>
  )
}
