import { useState, useEffect } from 'react'
import type { TimerValue } from '../../types'
import {
  parseTimerValue,
  getElapsedMs,
  formatTimerMs,
  formatTimerDateTime,
  DEFAULT_TIMER,
} from '../../utils/timer'

interface TimerInputProps {
  value: TimerValue | unknown
  onChange: (value: TimerValue) => void
  disabled?: boolean
  className?: string
}

function buildTimerTooltip(timer: TimerValue): string {
  const lines: string[] = []
  if (timer.startedAt) lines.push(`Started: ${formatTimerDateTime(timer.startedAt)}`)
  if (timer.stoppedAt) lines.push(`Stopped: ${formatTimerDateTime(timer.stoppedAt)}`)
  return lines.join('\n')
}

export function TimerInput({
  value,
  onChange,
  disabled = false,
  className = '',
}: TimerInputProps) {
  const timer = parseTimerValue(value)
  const [displayMs, setDisplayMs] = useState(() => getElapsedMs(timer))
  const isRunning = !!timer.startedAt

  useEffect(() => {
    if (!isRunning) {
      setDisplayMs(timer.totalElapsedMs)
      return
    }
    const id = setInterval(() => {
      setDisplayMs(getElapsedMs(timer))
    }, 50)
    return () => clearInterval(id)
  }, [isRunning, timer.totalElapsedMs, timer.startedAt])

  const handleStart = () => {
    if (disabled) return
    onChange({ totalElapsedMs: timer.totalElapsedMs, startedAt: new Date().toISOString() })
  }

  const handleStop = () => {
    if (disabled) return
    const elapsed = getElapsedMs(timer)
    const stoppedAt = new Date().toISOString()
    onChange({ totalElapsedMs: elapsed, startedAt: undefined, stoppedAt })
    setDisplayMs(elapsed)
  }

  const handleClear = () => {
    if (disabled) return
    if (!window.confirm('Clear timer and reset to 0:00.000?')) return
    onChange(DEFAULT_TIMER)
    setDisplayMs(0)
  }

  const tooltip = buildTimerTooltip(timer)

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span
        className="min-w-[7rem] font-mono text-lg tabular-nums text-foreground"
        aria-live="polite"
        title={tooltip || undefined}
      >
        {formatTimerMs(displayMs)}
      </span>
      <div className="flex gap-1">
        {!isRunning ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={disabled}
            className="rounded border border-border bg-green-600/20 px-3 py-1.5 text-sm text-green-600 hover:bg-green-600/30 disabled:opacity-50 dark:text-green-400"
          >
            Start
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStop}
            disabled={disabled}
            className="rounded border border-border bg-red-600/20 px-3 py-1.5 text-sm text-red-600 hover:bg-red-600/30 disabled:opacity-50 dark:text-red-400"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled}
          className="rounded border border-border bg-muted px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
