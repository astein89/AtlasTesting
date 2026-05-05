import { useEffect, useState } from 'react'
import { formatRemainingMmSs, remainingMsUntilIso } from '@/utils/amrContinueCountdown'

/** Live mm:ss until `continueNotBefore` ISO; hidden if deadline missing or past. */
export function AmrAutoContinueCountdown({
  continueNotBeforeIso,
  className = 'text-[11px] tabular-nums text-foreground/70',
}: {
  continueNotBeforeIso: string | null | undefined
  className?: string
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!continueNotBeforeIso?.trim()) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [continueNotBeforeIso])
  const ms = remainingMsUntilIso(continueNotBeforeIso ?? null)
  if (ms == null) return null
  /** 0s auto-continue: deadline is "now" — do not show a 0s countdown. */
  if (ms === 0) return null
  return <span className={className}>Release in {formatRemainingMmSs(ms)}</span>
}

/** Prominent auto-continue countdown for AMR mission list / dashboard rows (right side of the row “card”). */
export function AmrMissionCardAutoContinue({
  continueNotBeforeIso,
}: {
  continueNotBeforeIso: string | null | undefined
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!continueNotBeforeIso?.trim()) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [continueNotBeforeIso])
  const ms = remainingMsUntilIso(continueNotBeforeIso ?? null)
  if (ms == null) return null
  if (ms === 0) return null
  return (
    <div
      className="flex min-w-[5.5rem] shrink-0 flex-col items-center justify-center border-l border-border/60 pl-3 text-center"
      aria-live="polite"
    >
      <span className="text-lg font-semibold tabular-nums tracking-tight text-foreground sm:text-xl">
        Release in {formatRemainingMmSs(ms)}
      </span>
    </div>
  )
}
