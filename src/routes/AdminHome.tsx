import { Link } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { adminPath } from '@/lib/appPaths'

export function AdminHome() {
  const hasPermission = useAuthStore((s) => s.hasPermission)

  const cards: { to: string; title: string; description: string; perm: string }[] = [
    {
      to: adminPath('roles'),
      title: 'Roles',
      description: 'Define roles and which permissions each role has.',
      perm: 'roles.manage',
    },
    {
      to: adminPath('users'),
      title: 'Users',
      description: 'Create and edit user accounts and assign roles.',
      perm: 'users.manage',
    },
    {
      to: adminPath('settings'),
      title: 'Settings',
      description: 'Date/time formats, conditional formatting presets, and app defaults.',
      perm: 'settings.access',
    },
    {
      to: adminPath('db'),
      title: 'Database tables',
      description: 'Inspect raw tables (read-only).',
      perm: 'admin.db',
    },
  ]

  const visible = cards.filter((c) => hasPermission(c.perm))

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-2xl font-semibold text-foreground">Administration</h1>
      <p className="mb-8 text-sm text-foreground/70">
        System access and configuration. Changes to roles apply after the user&apos;s session refreshes (up to a few
        minutes) or on next login.
      </p>
      {visible.length === 0 ? (
        <p className="text-sm text-foreground/60">
          You can open this module but don&apos;t have permission for roles, users, settings, or the database. Ask an
          administrator to update your role.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((c) => (
            <li key={c.to}>
              <Link
                to={c.to}
                className="block rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-background"
              >
                <span className="font-medium text-foreground">{c.title}</span>
                <p className="mt-1 text-sm text-foreground/65">{c.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
