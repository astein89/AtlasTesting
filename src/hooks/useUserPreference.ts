import { useState, useEffect, useCallback } from 'react'
import { api, ensureAccessToken } from '../api/client'
import { useAuthStore } from '../store/authStore'
import {
  getPrefsCache,
  setPrefsCache,
  getPrefsPromise,
  setPrefsPromise,
  clearPreferencesCache,
} from '../lib/preferencesCache'

export { clearPreferencesCache }

async function fetchPrefs(): Promise<Record<string, string>> {
  const { accessToken, refreshToken } = useAuthStore.getState()
  if (!accessToken && !refreshToken) {
    return {}
  }

  if (refreshToken && !accessToken) {
    const ok = await ensureAccessToken()
    if (!ok) return {}
  }

  const cached = getPrefsCache()
  if (cached) return cached
  const existing = getPrefsPromise()
  if (existing) return existing
  const promise = api
    .get<Record<string, string>>('/preferences')
    .then((r) => {
      const data = r.data ?? {}
      setPrefsCache(data)
      return data
    })
    .catch(() => {
      setPrefsCache(null)
      return {}
    })
    .finally(() => setPrefsPromise(null))
  setPrefsPromise(promise)
  return promise
}

function getLocalFallback(key: string): string | null {
  try {
    return localStorage.getItem(`atlas-pref-${key}`)
  } catch {
    return null
  }
}

function setLocalFallback(key: string, value: string): void {
  try {
    localStorage.setItem(`atlas-pref-${key}`, value)
  } catch {
    // ignore
  }
}

export function useUserPreference<T>(
  key: string,
  defaultValue: T,
  serialize: (v: T) => string = JSON.stringify,
  deserialize: (s: string) => T = JSON.parse
): [T, (v: T | ((prev: T) => T)) => void] {
  const authedUserId = useAuthStore((s) => s.user?.id ?? '')

  const [state, setState] = useState<T>(() => {
    const local = getLocalFallback(key)
    if (local != null) {
      try {
        return deserialize(local)
      } catch {
        // ignore
      }
    }
    return defaultValue
  })

  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchPrefs().then((prefs) => {
      if (cancelled) return
      const stored = prefs[key]
      if (stored != null) {
        try {
          setState(deserialize(stored))
        } catch {
          // ignore
        }
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [key, authedUserId])

  useEffect(() => {
    if (!loaded) return
    try {
      const stored = getPrefsCache()?.[key] ?? getLocalFallback(key)
      if (stored != null) setState(deserialize(stored))
      else setState(defaultValue)
    } catch {
      setState(defaultValue)
    }
    // Intentionally *not* depending on defaultValue to avoid infinite
    // update loops when callers pass non-stable defaults (like [] or {}).
  }, [key, loaded])

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value
        const serialized = serialize(next)
        setLocalFallback(key, serialized)
        const cache = getPrefsCache()
        if (cache) cache[key] = serialized
        api.put('/preferences', { key, value: serialized }).catch(() => {
          // ignore - local fallback already set
        })
        return next
      })
    },
    [key, serialize]
  )

  return [state, setValue]
}
