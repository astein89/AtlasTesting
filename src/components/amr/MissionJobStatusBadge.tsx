import { missionJobStatusChipClass, missionJobStatusFriendly } from '@/utils/amrMissionJobStatus'

/** Friendly fleet job / mission status for tables (matches robot/container chip pattern). */
export function MissionJobStatusBadge({ value }: { value: unknown }) {
  const { label, code } = missionJobStatusFriendly(value)
  const chipCls = missionJobStatusChipClass(code)
  return (
    <span
      title={code != null ? `Job status code ${code}` : undefined}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-left text-xs font-medium ${chipCls}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {code != null ? (
        <span className="shrink-0 font-mono text-[11px] font-normal tabular-nums opacity-70">{code}</span>
      ) : null}
    </span>
  )
}
