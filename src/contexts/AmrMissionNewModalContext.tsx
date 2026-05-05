import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AmrMissionNewModal } from '@/components/amr/AmrMissionNewModal'

type AmrMissionNewModalContextValue = {
  openNewMission: (opts?: { search?: string }) => void
  closeNewMission: () => void
}

const AmrMissionNewModalContext = createContext<AmrMissionNewModalContextValue | null>(null)

export function AmrMissionNewModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [initialSearch, setInitialSearch] = useState<string | undefined>(undefined)

  const openNewMission = useCallback((opts?: { search?: string }) => {
    setInitialSearch(opts?.search)
    setOpen(true)
  }, [])

  const closeNewMission = useCallback(() => {
    setOpen(false)
    setInitialSearch(undefined)
  }, [])

  const value = useMemo(
    () => ({ openNewMission, closeNewMission }),
    [openNewMission, closeNewMission]
  )

  return (
    <AmrMissionNewModalContext.Provider value={value}>
      {children}
      <AmrMissionNewModal open={open} onClose={closeNewMission} initialSearch={initialSearch} />
    </AmrMissionNewModalContext.Provider>
  )
}

export function useAmrMissionNewModal(): AmrMissionNewModalContextValue | null {
  return useContext(AmrMissionNewModalContext)
}
