import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { PopupSelect } from '../components/ui/PopupSelect'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import type { User } from '../types'

const emptyForm = () => ({ username: '', name: '', password: '', role: 'user' as const })

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm())
  const [userModal, setUserModal] = useState<null | 'new' | string>(null)
  const { showAlert, showConfirm } = useAlertConfirm()

  const isEdit = userModal !== null && userModal !== 'new'

  useEffect(() => {
    load()
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
      name: u.name || '',
      password: '',
      role: u.role,
    })
    setUserModal(u.id)
  }

  const closeUserModal = () => {
    setUserModal(null)
    setForm(emptyForm())
  }

  const handleSave = async () => {
    try {
      if (isEdit) {
        await api.put(`/users/${userModal}`, form)
      } else {
        await api.post('/users', form)
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
            <p className="mt-0.5 truncate text-sm text-foreground/70">{u.name || '—'}</p>
            <p className="mt-0.5 truncate text-sm text-foreground/60">{u.role}</p>
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
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">Name</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">Role</th>
              <th className="px-4 py-2 text-right text-sm font-medium text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="bg-background">
                <td className="px-4 py-2 text-foreground">{u.username}</td>
                <td className="px-4 py-2 text-foreground">{u.name || '-'}</td>
                <td className="px-4 py-2 text-foreground">{u.role}</td>
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
          onSave={handleSave}
          onCancel={closeUserModal}
        />
      )}
    </div>
  )
}

interface UserFormModalProps {
  title: string
  form: { username: string; name: string; password: string; role: string }
  setForm: React.Dispatch<React.SetStateAction<{ username: string; name: string; password: string; role: string }>>
  isEdit: boolean
  onSave: () => void
  onCancel: () => void
}

function UserFormModal({ title, form, setForm, isEdit, onSave, onCancel }: UserFormModalProps) {
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
      onClick={onCancel}
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
          </div>
          <div className="sm:col-span-2">
            <PopupSelect
              value={form.role}
              onChange={(v) => setForm((f) => ({ ...f, role: v }))}
              options={[
                { value: 'user', label: 'User' },
                { value: 'viewer', label: 'Viewer' },
                { value: 'admin', label: 'Admin' },
              ]}
              label="Role"
              placeholder="Role"
            />
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
