import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'

type Handlers = {
  newFolder: (() => void) | null
  openUploadPicker: (() => void) | null
}

const FilesModuleHostContext = createContext<{
  setFilesModuleHandlers: (partial: Partial<Handlers>) => void
  requestNewFolder: () => void
  requestUploadPicker: () => void
} | null>(null)

/**
 * Bridges the Files sidebar (folder toolbar) to `FilesExplorer` without custom events.
 * Provider must wrap both the sidebar and the routed page so handlers are registered.
 */
export function FilesModuleHostProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Handlers>({ newFolder: null, openUploadPicker: null })

  const setFilesModuleHandlers = useCallback((partial: Partial<Handlers>) => {
    handlersRef.current = { ...handlersRef.current, ...partial }
  }, [])

  const requestNewFolder = useCallback(() => {
    handlersRef.current.newFolder?.()
  }, [])

  const requestUploadPicker = useCallback(() => {
    handlersRef.current.openUploadPicker?.()
  }, [])

  const value = useMemo(
    () => ({ setFilesModuleHandlers, requestNewFolder, requestUploadPicker }),
    [setFilesModuleHandlers, requestNewFolder, requestUploadPicker]
  )

  return <FilesModuleHostContext.Provider value={value}>{children}</FilesModuleHostContext.Provider>
}

export function useFilesModuleHost() {
  const ctx = useContext(FilesModuleHostContext)
  if (!ctx) {
    return {
      setFilesModuleHandlers: (_partial: Partial<Handlers>) => {},
      requestNewFolder: () => {},
      requestUploadPicker: () => {},
    }
  }
  return ctx
}
