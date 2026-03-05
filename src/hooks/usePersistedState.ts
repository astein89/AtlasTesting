import { useState, useEffect, useCallback } from 'react'

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  serialize: (v: T) => string = JSON.stringify,
  deserialize: (s: string) => T = JSON.parse
): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored != null) return deserialize(stored)
    } catch {
      // ignore
    }
    return defaultValue
  })

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored != null) setState(deserialize(stored))
      else setState(defaultValue)
    } catch {
      setState(defaultValue)
    }
  }, [key])

  useEffect(() => {
    try {
      localStorage.setItem(key, serialize(state))
    } catch {
      // ignore (quota, private mode, etc.)
    }
  }, [key, state, serialize])

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value
        return next
      })
    },
    []
  )

  return [state, setValue]
}
