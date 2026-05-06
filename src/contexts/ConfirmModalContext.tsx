import { createContext, useContext, type ReactNode } from 'react'

type ConfirmModalActions = {
  confirm: () => void
  cancel: () => void
}

const ConfirmModalContext = createContext<ConfirmModalActions | null>(null)

export function ConfirmModalActionsProvider({
  confirm,
  cancel,
  children,
}: ConfirmModalActions & { children: ReactNode }) {
  return <ConfirmModalContext.Provider value={{ confirm, cancel }}>{children}</ConfirmModalContext.Provider>
}

/** Present inside ConfirmModal body content so controls can trigger the same actions as the footer. */
export function useConfirmModalActions(): ConfirmModalActions | null {
  return useContext(ConfirmModalContext)
}
