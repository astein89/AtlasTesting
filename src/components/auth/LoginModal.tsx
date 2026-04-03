import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useLoginModalStore } from '@/store/loginModalStore'

const schema = z.object({
  username: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
})

type FormData = z.infer<typeof schema>

export function LoginModal() {
  const open = useLoginModalStore((s) => s.open)
  const returnTo = useLoginModalStore((s) => s.returnTo)
  const closeLogin = useLoginModalStore((s) => s.closeLogin)
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()
  const [error, setError] = useState('')
  /** Default on: session is stored in localStorage so closing the tab does not log you out. Uncheck for this-browser-session-only. */
  const [rememberMe, setRememberMe] = useState(true)

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
      setRememberMe(true)
    }
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLogin()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeLogin])

  const onSubmit = async (data: FormData) => {
    setError('')
    try {
      const { data: res } = await api.post<{
        accessToken: string
        refreshToken: string
        user: {
          id: string
          username: string
          name?: string
          role: string
          roles?: string[]
          permissions?: string[]
        }
      }>('/auth/login', { ...data, rememberMe })
      setAuth(
        {
          ...res.user,
          permissions: res.user.permissions,
        },
        res.accessToken,
        res.refreshToken,
        rememberMe
      )
      closeLogin()
      const target = returnTo?.trim() || '/'
      navigate(target, { replace: true })
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Login failed'
      )
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="login-modal-title"
      onClick={closeLogin}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="login-modal-title" className="mb-4 text-lg font-semibold text-foreground">
          Sign in
        </h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="login-modal-username" className="block text-sm font-medium text-foreground">
              Username
            </label>
            <input
              id="login-modal-username"
              type="text"
              {...register('username')}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              autoComplete="username"
              autoFocus
            />
            {errors.username && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.username.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="login-modal-password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="login-modal-password"
              type="password"
              {...register('password')}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              autoComplete="current-password"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.password.message}</p>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm text-foreground">Remember me</span>
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={closeLogin}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
