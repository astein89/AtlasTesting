import type { TimerValue } from '../types'

export const DEFAULT_TIMER: TimerValue = { totalElapsedMs: 0 }

export function parseTimerValue(value: unknown): TimerValue {
  if (value && typeof value === 'object' && 'totalElapsedMs' in value) {
    const v = value as { totalElapsedMs?: number; startedAt?: string; stoppedAt?: string }
    const total = typeof v.totalElapsedMs === 'number' && v.totalElapsedMs >= 0 ? v.totalElapsedMs : 0
    const startedAt = typeof v.startedAt === 'string' ? v.startedAt : undefined
    const stoppedAt = typeof v.stoppedAt === 'string' ? v.stoppedAt : undefined
    return { totalElapsedMs: total, startedAt, stoppedAt }
  }
  return DEFAULT_TIMER
}

/** Current elapsed ms (totalElapsedMs + current segment if running) */
export function getElapsedMs(t: TimerValue): number {
  if (t.startedAt) {
    const start = Date.parse(t.startedAt)
    if (!Number.isNaN(start)) {
      return t.totalElapsedMs + (Date.now() - start)
    }
  }
  return t.totalElapsedMs
}

export function formatTimerMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00:00.000'
  const totalMs = Math.floor(ms)
  const totalSec = Math.floor(totalMs / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const frac = totalMs % 1000
  const msStr = String(frac).padStart(3, '0')
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${msStr}`
  }
  return `${m}:${String(s).padStart(2, '0')}.${msStr}`
}

/** Format an ISO date string for timer tooltip (e.g. "Mar 4, 2025, 3:45:00 PM") */
export function formatTimerDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  return `${date}, ${time}`
}
