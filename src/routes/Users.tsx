import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import {
  PASSWORD_MAX_LENGTH,
  describePasswordRequirements,
  type PasswordPolicy,
} from '../lib/passwordPolicy'
import type { User } from '../types'

type UserForm = {
  username: string
  shortName: string
  name: string
  password: string
  roles: string[]
  /** Require password change on next successful login (admin). Cleared when saving a new password here. */
  mustChangePassword: boolean
}

const emptyForm = (): UserForm => ({
  username: '',
  shortName: '',
  name: '',
  password: '',
  roles: [],
  mustChangePassword: false,
})

function formatRolesList(u: User): string {
  if (u.roles && u.roles.length > 0) return u.roles.join(', ')
  return u.role
}

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([
    { value: 'admin', label: 'Admin' },
    { value: 'user', label: 'User' },
    { value: 'viewer', label: 'Viewer' },
  ])
  const [form, setForm] = useState<UserForm>(emptyForm())
  const [userModal, setUserModal] = useState<null | 'new' | string>(null)
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null)
  const { showAlert, showConfirm } = useAlertConfirm()

  const isEdit = userModal !== null && userModal !== 'new'

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    api
      .get<Array<{ slug: string; label: string }>>('/roles/options')
      .then((r) =>
        setRoleOptions(r.data.map((x) => ({ value: x.slug, label: `${x.label} (${x.slug})` })))
      )
      .catch(() => {
        /* keep defaults */
      })
  }, [])

  useEffect(() => {
    api
      .get<PasswordPolicy>('/settings/password-policy')
      .then((r) => setPasswordPolicy(r.data))
      .catch(() => setPasswordPolicy(null))
  }, [])

  const load = () => {
    api
      .get<User[]>('/users')
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }

  const openAddModal = () => {
    setForm(emptyForm())
    setUserModal('new')
  }

  const openEditModal = (u: User) => {
    setForm({
      username: u.username,
      shortName: u.shortName || '',
      name: u.name || '',
      password: '',
      roles: u.roles && u.roles.length > 0 ? [...u.roles] : [u.role],
      mustChangePassword: u.mustChangePassword === true,
    })
    setUserModal(u.id)
  }

  const closeUserModal = () => {
    setUserModal(null)
    setForm(emptyForm())
  }

  const toggleRole = (slug: string) => {
    setForm((f) => {
      const has = f.roles.includes(slug)
      if (has && f.roles.length <= 1) return f
      if (has) return { ...f, roles: f.roles.filter((x) => x !== slug) }
      return { ...f, roles: [...f.roles, slug] }
    })
  }

  const handleSave = async () => {
    if (form.roles.length === 0) {
      showAlert('Select at least one role.')
      return
    }
    try {
      if (isEdit) {
        const payload: Record<string, unknown> = {
          username: form.username,
          short_name: form.shortName.trim() || null,
          name: form.name,
          roles: form.roles,
        }
        if (form.password.trim()) payload.password = form.password
        if (!form.password.trim()) {
          payload.must_change_password = form.mustChangePassword
        }
        await api.put(`/users/${userModal}`, payload)
      } else {
        await api.post('/users', {
          username: form.username,
          short_name: form.shortName.trim() || undefined,
          name: form.name,
          password: form.password,
          roles: form.roles,
          must_change_password: form.mustChangePassword,
        })
      }
      load()
      closeUserModal()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to save')
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await showConfirm('Delete this user?', { title: 'Delete user', variant: 'danger', confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await api.delete(`/users/${id}`)
      load()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to delete')
    }
  }

  if (loading) return <p className="text-foreground/60">Loading...</p>

  return (
    <div className="w-full min-w-0">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Users</h1>
        <button
          type="button"
          onClick={openAddModal}
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
        >
          Add User
        </button>
      </div>

      {/* Mobile: card layout */}
      <div className="w-full min-w-0 space-y-2 md:hidden">
        {users.map((u) => (
          <div
            key={u.id}
            className="w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card px-4 py-3"
          >
            <p className="truncate font-medium text-foreground">{u.username}</p>
            {u.shortName ? (
              <p className="mt-0.5 truncate text-sm text-foreground/70">Short: {u.shortName}</p>
            ) : null}
            <p className="mt-0.5 truncate text-sm text-foreground/70">{u.name || '—'}</p>
            <p className="mt-0.5 break-words text-sm text-foreground/60">{formatRolesList(u)}</p>
            {u.mustChangePassword ? (
              <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                Must change password on next login
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openEditModal(u)}
                className="min-h-[44px] rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(u.id)}
                className="min-h-[44px] rounded border border-red-500/50 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden w-full min-w-0 overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full">
          <thead className="bg-card">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">Username</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">Short name</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">Name</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">Roles</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">Password</th>
              <th className="px-4 py-2 text-right text-sm font-medium text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="bg-background">
                <td className="px-4 py-2 text-foreground">{u.username}</td>
                <td className="px-4 py-2 text-foreground">{u.shortName || '—'}</td>
                <td className="px-4 py-2 text-foreground">{u.name || '-'}</td>
                <td className="max-w-md px-4 py-2 text-foreground">{formatRolesList(u)}</td>
                <td className="px-4 py-2 text-foreground">
                  {u.mustChangePassword ? (
                    <span className="inline-block rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                      Change on login
                    </span>
                  ) : (
                    <span className="text-sm text-foreground/50">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => openEditModal(u)}
                    className="mr-2 text-primary hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(u.id)}
                    className="text-red-500 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit User modal */}
      {userModal !== null && (
        <UserFormModal
          title={isEdit ? 'Edit User' : 'Add User'}
          form={form}
          setForm={setForm}
          isEdit={isEdit}
          roleOptions={roleOptions}
          toggleRole={toggleRole}
          onSave={handleSave}
          onCancel={closeUserModal}
          passwordPolicy={passwordPolicy}
        />
      )}
    </div>
  )
}

interface UserFormModalProps {
  title: string
  form: UserForm
  setForm: React.Dispatch<React.SetStateAction<UserForm>>
  isEdit: boolean
  roleOptions: { value: string; label: string }[]
  toggleRole: (slug: string) => void
  onSave: () => void
  onCancel: () => void
  passwordPolicy: PasswordPolicy | null
}

function UserFormModal({
  title,
  form,
  setForm,
  isEdit,
  roleOptions,
  toggleRole,
  onSave,
  onCancel,
  passwordPolicy,
}: UserFormModalProps) {
  const [showPassword, setShowPassword] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <div
        className="flex w-full max-w-md flex-col rounded-xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="user-modal-title" className="mb-4 text-lg font-semibold text-foreground">
          {title}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Username</label>
            <input
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Short name (optional)</label>
            <input
              value={form.shortName}
              onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Name</label>
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">
              {isEdit ? 'New password (leave blank to keep current)' : 'Password'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={isEdit ? 'Leave blank to keep current' : 'Password'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                minLength={passwordPolicy && (!isEdit || form.password.trim()) ? passwordPolicy.minLength : undefined}
                maxLength={PASSWORD_MAX_LENGTH}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-foreground"
              />
              <button
                type="button"
                onPointerDown={() => setShowPassword(true)}
                onPointerUp={() => setShowPassword(false)}
                onPointerLeave={() => setShowPassword(false)}
                onPointerCancel={() => setShowPassword(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-foreground/50 hover:bg-background hover:text-foreground"
                aria-label="Hold to show password"
              >
                {showPassword ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            {passwordPolicy && (!isEdit || form.password.trim()) ? (
              <p className="text-xs text-foreground/65">
                Requirements: {describePasswordRequirements(passwordPolicy).join('; ')}.
              </p>
            ) : null}
            {form.password.trim() ? (
              <p className="mt-2 text-xs text-foreground/65">
                Saving a new password clears the &quot;change on next login&quot; requirement for this user.
              </p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border"
                checked={form.mustChangePassword}
                disabled={Boolean(form.password.trim())}
                onChange={(e) => setForm((f) => ({ ...f, mustChangePassword: e.target.checked }))}
              />
              <span>
                <span className="font-medium">Require password change on next login</span>
                {form.password.trim() ? (
                  <span className="mt-0.5 block text-xs text-foreground/65">
                    Not available while setting a new password above (that clears the requirement).
                  </span>
                ) : null}
              </span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <span className="mb-2 block text-sm font-medium text-foreground">Roles</span>
            <p className="mb-2 text-xs text-foreground/65">
              Permissions from all selected roles are combined. At least one role is required.
            </p>
            <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-3">
              {roleOptions.map((opt) => (
                <li key={opt.value}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-border"
                      checked={form.roles.includes(opt.value)}
                      onChange={() => toggleRole(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
          >
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
