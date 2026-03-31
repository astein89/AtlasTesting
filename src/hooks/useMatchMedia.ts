import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query. Uses legacy addListener/removeListener when
 * addEventListener is missing (Safari < 14), which otherwise throws and can blank the page.
 */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    setMatches(mq.matches)
    const handler = () => setMatches(mq.matches)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    mq.addListener(handler)
    return () => mq.removeListener(handler)
  }, [query])

  return matches
}
