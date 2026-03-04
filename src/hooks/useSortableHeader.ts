import { useRef } from 'react'

const LONG_PRESS_MS = 500

export function useSortableHeader<K>(onSort: (key: K, addSecondary: boolean) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handledRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  return (key: K) => ({
    onClick: (e: React.MouseEvent) => {
      if (handledRef.current) {
        handledRef.current = false
        return
      }
      onSort(key, e.shiftKey)
    },
    onTouchStart: () => {
      handledRef.current = false
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        onSort(key, true)
        handledRef.current = true
      }, LONG_PRESS_MS)
    },
    onTouchEnd: clearTimer,
    onTouchCancel: clearTimer,
  })
}
