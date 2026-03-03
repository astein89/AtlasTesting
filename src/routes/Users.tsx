import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal'
import type { User } from '../types'

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'user' })
  const [showNew, setShowNew] = useState(false)
  const [changePasswordFor, setChangePasswordFor] = useState<string | null>(null)

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

  const handleSave = async (id?: string) => {
    try {
      if (id) {
        await api.put(`/users/${id}`, form)
      } else {
        await api.post('/users', form)
        setShowNew(false)
        setForm({ username: '', name: '', password: '', role: 'user' })
      }
      load()
      setEditing(null)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to save')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user?')) return
    try {
      await api.delete(`/users/${id}`)
      load()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to delete')
    }
  }

  if (loading) return <p className="text-foreground/60">Loading...</p>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Users</h1>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
        >
          Add User
        </button>
      </div>
      {showNew && (
        <div className="mb-6 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 font-medium text-foreground">New User</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <input
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
            <input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => handleSave()}
              className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNew(false)
                setForm({ username: '', name: '', password: '', role: 'user' })
              }}
              className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full">
          <thead className="bg-card">
              <tr>
                <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                  Username
                </th>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                Name
              </th>
              <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                Role
              </th>
              <th className="px-4 py-2 text-right text-sm font-medium text-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="bg-background">
                {editing === u.id ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        value={form.username}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, username: e.target.value }))
                        }
                        className="w-full rounded border border-border bg-background px-2 py-1 text-foreground"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={form.name}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, name: e.target.value }))
                        }
                        className="w-full rounded border border-border bg-background px-2 py-1 text-foreground"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={form.role}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, role: e.target.value }))
                        }
                        className="rounded border border-border bg-background px-2 py-1 text-foreground"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleSave(u.id)}
                        className="mr-2 text-primary hover:underline"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="text-foreground/60 hover:underline"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2 text-foreground">{u.username}</td>
                    <td className="px-4 py-2 text-foreground">{u.name || '-'}</td>
                    <td className="px-4 py-2 text-foreground">{u.role}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(u.id)
                          setForm({
                            username: u.username,
                            name: u.name || '',
                            password: '',
                            role: u.role,
                          })
                        }}
                        className="mr-2 text-primary hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setChangePasswordFor(u.id)}
                        className="mr-2 text-primary hover:underline"
                      >
                        Change password
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(u.id)}
                        className="text-red-500 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {changePasswordFor && (
        <ChangePasswordModal
          userId={changePasswordFor}
          isAdmin
          onClose={() => setChangePasswordFor(null)}
          onSuccess={() => setChangePasswordFor(null)}
        />
      )}
    </div>
  )
}
