import { create } from 'zustand'

type LoginModalState = {
  open: boolean
  /** After successful login, navigate here (pathname + search). */
  returnTo: string | null
  openLogin: (opts?: { returnTo?: string | null }) => void
  closeLogin: () => void
}

export const useLoginModalStore = create<LoginModalState>((set) => ({
  open: false,
  returnTo: null,
  openLogin: (opts) => set({ open: true, returnTo: opts?.returnTo ?? null }),
  closeLogin: () => set({ open: false, returnTo: null }),
}))
