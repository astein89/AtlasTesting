import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

type FormData = z.infer<typeof schema>

export function Login() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)
  const [error, setError] = useState('')
  const [rememberMe, setRememberMe] = useState(false)

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setError('')
    try {
      const { data: res } = await api.post<{
        accessToken: string
        refreshToken: string
        user: { id: string; username: string; name?: string; role: string }
      }>('/auth/login', data)
      setAuth(res.user, res.accessToken, res.refreshToken, rememberMe)
      navigate('/')
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Login failed'
      )
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-900">
      <div className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-800 p-6 shadow">
        <h1 className="mb-6 text-xl font-semibold text-white">Automation Testing</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-neutral-200">
              Username
            </label>
            <input
              id="username"
              type="text"
              {...register('username')}
              className="mt-1 w-full rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-white placeholder-neutral-500"
              autoComplete="username"
            />
            {errors.username && (
              <p className="mt-1 text-sm text-red-500">{errors.username.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-neutral-200">
              Password
            </label>
            <input
              id="password"
              type="password"
              {...register('password')}
              className="mt-1 w-full rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-white placeholder-neutral-500"
              autoComplete="current-password"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-600 bg-neutral-900 text-blue-600"
            />
            <span className="text-sm text-neutral-200">Remember me (stay signed in for 7 days)</span>
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
