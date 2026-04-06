import { useEffect } from 'react'
import type { DependencyList } from 'react'

/**
 * Runs an async function with an `AbortSignal` that aborts when `deps` change or on unmount.
 * Pass `signal` into axios: `api.get(url, { signal })` so navigations cancel in-flight work
 * and avoid stuck spinners (with the global API timeout in `api/client.ts`).
 */
export function useAbortableEffect(
  fn: (signal: AbortSignal) => void | Promise<void>,
  deps: DependencyList
): void {
  useEffect(() => {
    const ac = new AbortController()
    void fn(ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies stable `fn` via useCallback or inline with explicit deps
  }, deps)
}
