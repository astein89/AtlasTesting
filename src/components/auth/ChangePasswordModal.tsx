import { useState } from 'react'
import { api } from '../../api/client'

interface ChangePasswordModalProps {
  onClose: () => void
  onSuccess?: () => void
  userId?: string
  isAdmin?: boolean
}

export function ChangePasswordModal({
  onClose,
  onSuccess,
  userId,
  isAdmin = false,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (!isAdmin && !currentPassword) {
      setError('Current password required')
      return
    }

    setSubmitting(true)
    try {
      if (isAdmin && userId) {
        await api.put(`/users/${userId}/password`, { newPassword })
      } else {
        await api.post('/auth/change-password', {
          currentPassword,
          newPassword,
        })
      }
      onSuccess?.()
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Failed to change password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-xl border border-border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow sm:rounded-lg sm:pb-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          {isAdmin ? 'Set User Password' : 'Change Password'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isAdmin && (
            <div>
              <label className="block text-sm font-medium text-foreground">
                Current password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground">
              New password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              required
              minLength={6}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] min-w-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
