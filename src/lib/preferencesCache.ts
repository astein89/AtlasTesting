const cache: {
  prefs: Record<string, string> | null
  promise: Promise<Record<string, string>> | null
} = {
  prefs: null,
  promise: null,
}

export function getPrefsCache() {
  return cache.prefs
}

export function setPrefsCache(value: Record<string, string> | null) {
  cache.prefs = value
}

export function getPrefsPromise() {
  return cache.promise
}

export function setPrefsPromise(value: Promise<Record<string, string>> | null) {
  cache.promise = value
}

export function clearPreferencesCache(): void {
  cache.prefs = null
  cache.promise = null
}
