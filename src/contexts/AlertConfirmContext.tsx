import React, { createContext, useCallback, useContext, useState } from 'react'
import { AlertModal } from '../components/ui/AlertModal'
import { ConfirmModal } from '../components/ui/ConfirmModal'

interface AlertConfirmContextValue {
  showAlert: (message: string, title?: string) => void
  showConfirm: (message: string, options?: { title?: string; confirmLabel?: string; cancelLabel?: string; variant?: 'danger' | 'default' }) => Promise<boolean>
}

const AlertConfirmContext = createContext<AlertConfirmContextValue | null>(null)

export function AlertConfirmProvider({ children }: { children: React.ReactNode }) {
  const [alert, setAlert] = useState<{ message: string; title?: string } | null>(null)
  const [confirmState, setConfirmState] = useState<{
    message: string
    title?: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: 'danger' | 'default'
    resolve: (value: boolean) => void
  } | null>(null)

  const showAlert = useCallback((message: string, title?: string) => {
    setAlert({ message, title })
  }, [])

  const showConfirm = useCallback(
    (
      message: string,
      options?: { title?: string; confirmLabel?: string; cancelLabel?: string; variant?: 'danger' | 'default' }
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmState({
          message,
          title: options?.title,
          confirmLabel: options?.confirmLabel,
          cancelLabel: options?.cancelLabel,
          variant: options?.variant,
          resolve,
        })
      })
    },
    []
  )

  const handleConfirmOk = useCallback(() => {
    confirmState?.resolve(true)
    setConfirmState(null)
  }, [confirmState])

  const handleConfirmCancel = useCallback(() => {
    confirmState?.resolve(false)
    setConfirmState(null)
  }, [confirmState])

  return (
    <AlertConfirmContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      <AlertModal
        open={!!alert}
        title={alert?.title}
        message={alert?.message ?? ''}
        onClose={() => setAlert(null)}
      />
      <ConfirmModal
        open={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message ?? ''}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        variant={confirmState?.variant}
        onConfirm={handleConfirmOk}
        onCancel={handleConfirmCancel}
      />
    </AlertConfirmContext.Provider>
  )
}

export function useAlertConfirm(): AlertConfirmContextValue {
  const ctx = useContext(AlertConfirmContext)
  if (!ctx) {
    throw new Error('useAlertConfirm must be used within AlertConfirmProvider')
  }
  return ctx
}
