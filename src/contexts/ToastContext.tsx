import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ToastApi = { dismiss: () => void }

export type PushToastOptions = {
  /** Auto-remove after this many ms. Values ≤ 0 keep the toast until dismissed. */
  durationMs: number
  render: (api: ToastApi) => ReactNode
}

type ToastContextValue = {
  pushToast: (opts: PushToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const v = useContext(ToastContext)
  if (!v) throw new Error('useToast must be used within ToastProvider')
  return v
}

type ToastItem = {
  id: string
  durationMs: number
  render: (api: ToastApi) => ReactNode
}

function newToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())

  const removeToast = useCallback((id: string) => {
    const tid = timersRef.current.get(id)
    if (tid != null) {
      window.clearTimeout(tid)
      timersRef.current.delete(id)
    }
    setItems((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const pushToast = useCallback((opts: PushToastOptions) => {
    const id = newToastId()
    setItems((prev) => [...prev, { id, durationMs: opts.durationMs, render: opts.render }])
  }, [])

  useEffect(() => {
    for (const item of items) {
      if (timersRef.current.has(item.id)) continue
      if (item.durationMs <= 0) continue
      const tid = window.setTimeout(() => {
        timersRef.current.delete(item.id)
        removeToast(item.id)
      }, item.durationMs)
      timersRef.current.set(item.id, tid)
    }
  }, [items, removeToast])

  useEffect(() => {
    return () => {
      for (const tid of timersRef.current.values()) window.clearTimeout(tid)
      timersRef.current.clear()
    }
  }, [])

  const value = useMemo(() => ({ pushToast }), [pushToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-w-[min(100vw-2rem,26rem)] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg"
          >
            <div className="min-w-0 flex-1 text-sm leading-snug text-foreground">
              {item.render({ dismiss: () => removeToast(item.id) })}
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-foreground/70 hover:bg-muted"
              onClick={() => removeToast(item.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
