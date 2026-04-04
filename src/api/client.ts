import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../store/authStore'
import { getBasePath } from '../lib/basePath'

const basePath = getBasePath()

const api = axios.create({
  baseURL: `${basePath}/api`,
  headers: { 'Content-Type': 'application/json' },
})

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
