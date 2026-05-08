import { amrQueuedUiParts } from '@/utils/amrMissionQueuedDependency'

/** Compact reason + first dependency line for mission tables (uses JOINed queue fields on the row). */
export function MissionQueueWaitingCell({ flat }: { flat: Record<string, unknown> }) {
  const { reasonShort, waitingLines } = amrQueuedUiParts({ record: flat, session: null })
  if (!reasonShort && waitingLines.length === 0) {
    return <span className="text-foreground/45">—</span>
  }
  return (
    <div className="min-w-0">
      {reasonShort ? (
        <span className="block text-xs font-medium leading-snug text-foreground/90">{reasonShort}</span>
      ) : null}
      {waitingLines[0] ? (
        <span
          className="mt-0.5 block text-[11px] leading-snug text-foreground/65"
          title={waitingLines.join('\n')}
        >
          {waitingLines[0]}
        </span>
      ) : null}
    </div>
  )
}
