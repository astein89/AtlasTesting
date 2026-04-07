import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(1, 'Required'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormData = z.infer<typeof schema>

export function ForcedPasswordChangeModal() {
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const setAuth = useAuthStore((s) => s.setAuth)
  const [error, setError] = useState('')

  const open = Boolean(user?.mustChangePassword && accessToken)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (open) {
      setError('')
      reset()
    }
  }, [open, reset])

  const onSubmit = async (data: FormData) => {
    setError('')
    const rt = useAuthStore.getState().refreshToken
    if (!rt) {
      setError('Session expired. Please sign in again.')
      return
    }
    try {
      const { data: res } = await api.post<{
        accessToken: string
        user: {
          id: string
          username: string
          shortName?: string
          name?: string
          role: string
          roles?: string[]
          permissions?: string[]
          mustChangePassword: boolean
        }
      }>('/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      })
      setAuth(
        {
          ...res.user,
          permissions: res.user.permissions,
          mustChangePassword: res.user.mustChangePassword,
        },
        res.accessToken,
        rt
      )
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Could not update password'
      )
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 print:hidden"
      role="dialog"
      aria-modal
      aria-labelledby="forced-pw-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="forced-pw-title" className="mb-1 text-lg font-semibold text-foreground">
          Update your password
        </h2>
        <p className="mb-4 text-sm text-foreground/80">
          Your current password no longer meets this app&apos;s password rules. Choose a new password to
          continue.
        </p>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="forced-pw-current" className="block text-sm font-medium text-foreground">
              Current password
            </label>
            <input
              id="forced-pw-current"
              type="password"
              {...register('currentPassword')}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              autoComplete="current-password"
              autoFocus
            />
            {errors.currentPassword && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {errors.currentPassword.message}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="forced-pw-new" className="block text-sm font-medium text-foreground">
              New password
            </label>
            <input
              id="forced-pw-new"
              type="password"
              {...register('newPassword')}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              autoComplete="new-password"
            />
            {errors.newPassword && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.newPassword.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="forced-pw-confirm" className="block text-sm font-medium text-foreground">
              Confirm new password
            </label>
            <input
              id="forced-pw-confirm"
              type="password"
              {...register('confirmPassword')}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              autoComplete="new-password"
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting || !refreshToken}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isSubmitting ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
