import { useEffect, useId } from 'react'

const DIAGRAM = `      -- Standard CRON Syntax --
┌──────────── [optional] seconds (0 - 59)
| ┌────────── minute (0 - 59)
| | ┌──────── hour (0 - 23)
| | | ┌────── day of month (1 - 31)
| | | | ┌──── month (1 - 12) OR jan,feb,mar,apr ...
| | | | | ┌── day of week (0 - 6, sunday=0) OR sun,mon ...
| | | | | |
* * * * * * command`

const TABLE_ROWS: { sym: string; meaning: string; example: string; equivalent: string }[] = [
  { sym: '*', meaning: 'Any value', example: '* * * * *', equivalent: 'Every minute' },
  { sym: '-', meaning: 'Range of values', example: '1-10 * * * *', equivalent: 'Minutes 1 through 10' },
  { sym: ',', meaning: 'List of values', example: '1,10 * * * *', equivalent: 'At minutes 1 and 10' },
  { sym: '/', meaning: 'Step values', example: '*/10 * * * *', equivalent: 'Every 10 minutes' },
  {
    sym: '@yearly',
    meaning: 'Once every year at midnight of 1 January',
    example: '@yearly',
    equivalent: '0 0 1 1 *',
  },
  {
    sym: '@annually',
    meaning: 'Same as @yearly',
    example: '@annually',
    equivalent: '0 0 1 1 *',
  },
  {
    sym: '@monthly',
    meaning: 'Once a month at midnight on the first day',
    example: '@monthly',
    equivalent: '0 0 1 * *',
  },
  {
    sym: '@weekly',
    meaning: 'Once a week at midnight on Sunday morning',
    example: '@weekly',
    equivalent: '0 0 * * 0',
  },
  { sym: '@daily', meaning: 'Once a day at midnight', example: '@daily', equivalent: '0 0 * * *' },
  { sym: '@midnight', meaning: 'Same as @daily', example: '@midnight', equivalent: '0 0 * * *' },
  {
    sym: '@hourly',
    meaning: 'Once an hour at the beginning of the hour',
    example: '@hourly',
    equivalent: '0 * * * *',
  },
  { sym: '@reboot', meaning: 'Run at startup', example: '@reboot', equivalent: '—' },
]

export function CronSyntaxHelpModal({ onClose }: { onClose: () => void }) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
          <h2 id={titleId} className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold leading-tight text-foreground">
            Cron syntax
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground"
            aria-label="Close"
          >
            <span className="text-2xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm text-foreground">
          <p className="text-foreground/80">
            Backup schedules are evaluated in the <strong>server&apos;s local timezone</strong>.
          </p>

          <pre className="overflow-x-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] leading-snug text-foreground sm:text-xs">
            {DIAGRAM}
          </pre>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-background/80">
                  <th className="px-3 py-2 font-semibold">Symbol</th>
                  <th className="px-3 py-2 font-semibold">Meaning</th>
                  <th className="px-3 py-2 font-mono font-semibold">Example</th>
                  <th className="px-3 py-2 font-semibold">Equivalent</th>
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row) => (
                  <tr key={row.sym} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono text-foreground/90">{row.sym}</td>
                    <td className="px-3 py-2 text-foreground/85">{row.meaning}</td>
                    <td className="px-3 py-2 font-mono text-xs text-foreground/90">{row.example}</td>
                    <td className="px-3 py-2 font-mono text-xs text-foreground/80">{row.equivalent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
