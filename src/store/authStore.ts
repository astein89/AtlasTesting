import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearPreferencesCache } from '../lib/preferencesCache'

interface User {
  id: string
  username: string
  name?: string
  role: 'admin' | 'user'
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
    }),
    {
      name: 'atlas-auth',
      partialize: (s) => ({
        rememberMe: s.rememberMe ?? false,
        ...(s.rememberMe ? { refreshToken: s.refreshToken } : {}),
      }),
      onRehydrateStorage: () => (state) => {
        const s = useAuthStore.getState()
        if (s.refreshToken && !s.user) {
          s.setInitializing(true)
        } else {
          s.setInitializing(false)
        }
      },
    }
  )
)
