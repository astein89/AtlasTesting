import axios from 'axios'
import { useAuthStore } from '../store/authStore'
import { getBasePath } from '../lib/basePath'

const basePath = getBasePath()

const api = axios.create({
  baseURL: `${basePath}/api`,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
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
          const { data } = await axios.post(`${basePath}/api/auth/refresh`, { refreshToken })
          useAuthStore.getState().setAccessToken(data.accessToken)
          original.headers.Authorization = `Bearer ${data.accessToken}`
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
