import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  initializing: boolean
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
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
      initializing: false,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, initializing: false }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setInitializing: (initializing) => set({ initializing }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
      isAdmin: () => get().user?.role === 'admin',
    }),
    {
      name: 'atlas-auth',
      partialize: (s) => ({ refreshToken: s.refreshToken }),
    }
  )
)
