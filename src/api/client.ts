import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../store/authStore'
import { getBasePath } from '../lib/basePath'

const basePath = getBasePath()

const api = axios.create({
  baseURL: `${basePath}/api`,
  headers: { 'Content-Type': 'application/json' },
  /** Avoid hung requests leaving spinners forever (wiki views, etc.). Large exports can override per-request. */
  timeout: 90_000,
})

/** Navigation/unmount abort or axios cancel — do not treat as a failed load or show an error toast. */
export function isAbortLikeError(e: unknown): boolean {
  const x = e as { code?: string; name?: string }
  return x?.code === 'ERR_CANCELED' || x?.name === 'CanceledError' || x?.name === 'AbortError'
}

function setAuthHeader(config: InternalAxiosRequestConfig, token: string) {
  const h = config.headers
  const value = `Bearer ${token}`
  if (h && typeof (h as { set?: (a: string, b: string) => void }).set === 'function') {
    ;(h as { set: (a: string, b: string) => void }).set('Authorization', value)
  } else if (h) {
    ;(h as { Authorization?: string }).Authorization = value
  }
}

let refreshInFlight: Promise<string> | null = null

async function refreshAccessTokenOnce(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken
  if (!refreshToken) throw new Error('no refresh token')
  const { data } = await axios.post<{ accessToken: string }>(
    `${basePath}/api/auth/refresh`,
    { refreshToken }
  )
  useAuthStore.getState().setAccessToken(data.accessToken)
  return data.accessToken
}

/** One in-flight refresh for the whole app (prefs, AuthInit, 401 retries). */
function refreshAccessTokenDeduped(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessTokenOnce().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

/**
 * Ensures a non-persisted access token exists when a refresh token is present (e.g. after rehydrate).
 * Returns false if there is no session or refresh fails.
 */
export async function ensureAccessToken(): Promise<boolean> {
  if (useAuthStore.getState().accessToken) return true
  if (!useAuthStore.getState().refreshToken) return false
  try {
    await refreshAccessTokenDeduped()
    return true
  } catch {
    return false
  }
}

api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    delete (config.headers as { 'Content-Type'?: string })['Content-Type']
  }
  const token = useAuthStore.getState().accessToken
  if (token) {
    setAuthHeader(config, token)
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    const isRefreshRequest =
      typeof original?.url === 'string' && original.url.includes('/auth/refresh')
    if (err.response?.status === 403) {
      const code = (err.response.data as { code?: string } | undefined)?.code
      if (code === 'PASSWORD_CHANGE_REQUIRED') {
        const u = useAuthStore.getState().user
        if (u) {
          useAuthStore.setState({ user: { ...u, mustChangePassword: true } })
        }
      }
    }
    if (err.response?.status === 401 && !original._retry && !isRefreshRequest) {
      original._retry = true
      const refreshToken = useAuthStore.getState().refreshToken
      const loginHref = `${basePath}/?login=1`
      if (refreshToken) {
        try {
          await refreshAccessTokenDeduped()
          const token = useAuthStore.getState().accessToken
          if (token) setAuthHeader(original, token)
          return api(original)
        } catch {
          useAuthStore.getState().logout()
          window.location.href = loginHref
        }
      }
      // No refresh token: typical anonymous session — do not redirect; let callers handle 401 (e.g. preferences on public home).
    }
    return Promise.reject(err)
  }
)

export { api }
