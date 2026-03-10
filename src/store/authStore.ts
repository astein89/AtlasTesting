import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { clearPreferencesCache } from '../lib/preferencesCache'

const AUTH_STORAGE_KEY = 'atlas-auth'
const AUTH_REMEMBER_FLAG_KEY = 'atlas-auth-remember'

/** Persist to sessionStorage (browser session) when !rememberMe, localStorage (30d) when rememberMe */
const authStorageBackend = {
  getItem: (name: string): string | null => {
    if (typeof window === 'undefined') return null
    const keysToTry = [name, AUTH_STORAGE_KEY].filter((k, i, a) => a.indexOf(k) === i)
    for (const key of keysToTry) {
      const fromLocal = localStorage.getItem(key)
      if (fromLocal != null && fromLocal !== '') return fromLocal
      const fromSession = sessionStorage.getItem(key)
      if (fromSession != null && fromSession !== '') return fromSession
    }
    return null
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === 'undefined') return
    const key = name || AUTH_STORAGE_KEY
    try {
      const parsed = JSON.parse(value) as { state?: { rememberMe?: boolean } }
      const rememberMe = parsed?.state?.rememberMe === true
      if (rememberMe) {
        localStorage.setItem(key, value)
        localStorage.setItem(AUTH_STORAGE_KEY, value)
        sessionStorage.removeItem(key)
        sessionStorage.removeItem(AUTH_STORAGE_KEY)
      } else {
        sessionStorage.setItem(key, value)
        sessionStorage.setItem(AUTH_STORAGE_KEY, value)
        localStorage.removeItem(key)
        localStorage.removeItem(AUTH_STORAGE_KEY)
      }
      localStorage.setItem(AUTH_REMEMBER_FLAG_KEY, String(rememberMe))
    } catch {
      localStorage.setItem(key, value)
      sessionStorage.setItem(key, value)
      localStorage.setItem(AUTH_STORAGE_KEY, value)
      sessionStorage.setItem(AUTH_STORAGE_KEY, value)
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === 'undefined') return
    const key = name || AUTH_STORAGE_KEY
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
    localStorage.removeItem(AUTH_STORAGE_KEY)
    sessionStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(AUTH_REMEMBER_FLAG_KEY)
  },
}

interface User {
  id: string
  username: string
  name?: string
  role: 'admin' | 'user' | 'viewer'
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  rememberMe: boolean
  initializing: boolean
  setAuth: (user: User, accessToken: string, refreshToken: string, rememberMe?: boolean) => void
  setAccessToken: (token: string) => void
  setInitializing: (v: boolean) => void
  logout: () => void
  isAdmin: () => boolean
  /** False for viewer; true for admin and user (can add/edit/delete data). */
  canEditData: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      rememberMe: false,
      initializing: true,
      setAuth: (user, accessToken, refreshToken, rememberMe = false) =>
        set({ user, accessToken, refreshToken, rememberMe, initializing: false }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setInitializing: (initializing) => set({ initializing }),
      logout: () => {
        clearPreferencesCache()
        set({ user: null, accessToken: null, refreshToken: null })
      },
      isAdmin: () => get().user?.role === 'admin',
      canEditData: () => {
        const role = get().user?.role
        return role === 'admin' || role === 'user'
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => authStorageBackend),
      partialize: (s) => ({
        rememberMe: s.rememberMe ?? false,
        user: s.user ?? null,
        refreshToken: s.refreshToken ?? null,
      }),
      onRehydrateStorage: () => (persisted) => {
        const state = persisted?.state as { user?: unknown; refreshToken?: string } | undefined
        const hasRefresh = !!state?.refreshToken
        const hasUser = !!state?.user
        if (hasRefresh && !hasUser) {
          useAuthStore.getState().setInitializing(true)
        } else {
          useAuthStore.getState().setInitializing(false)
        }
      },
    }
  )
)
