# Active missions: all types + always-visible table

## Goals

1. **Active Missions** lists all in-flight app missions (non-completed multistop + single missions that are not finalized and not terminal by [`missionLastStatusIsActive`](src/utils/amrMissionJobStatus.ts)), with **no duplicate** rows in Mission History.
2. **Always show** the Active Missions section: do **not** condition the whole block on `active.length > 0`. When there are no active missions, still render the section heading and a table (or card) with a short **empty state** (e.g. “No active missions” / “Nothing in progress”), consistent with how Mission History handles an empty list.

## Implementation notes

### Partition ([`amrMultistopDisplay.ts`](src/utils/amrMultistopDisplay.ts))

- Add `isActiveSingleMissionRecord` (`!finalized && missionLastStatusIsActive(last_status)`).
- Refactor `partitionMissionGroupsForTables` → `{ active: GroupedMissionRow[]; history: GroupedMissionRow[] }`.
- Multistop: not completed → active; completed → history.
- Single: active helper → active; else → history.

### [`AmrMissions.tsx`](src/routes/amr/AmrMissions.tsx)

- Wire `active` / `history`; stale-hide filter applies only to history groups.
- **Active table UI**: remove `sortedActiveMultistop.length > 0 ? ( ... ) : null` — always render `<section>…</section>` for Active Missions.
- **Empty state**: if `sortedActiveMissionGroups.length === 0`, show a single table body row or a `<p>` inside the bordered card (mirror tone/pattern used for “No app missions yet” in Mission History).
- Branch rows: multistop → existing summary / attention behavior; single → detail modal on click.

### [`AmrDashboard.tsx`](src/routes/amr/AmrDashboard.tsx)

- Use new partition shape; optional **always-show** the active card with empty state when `active.length === 0` (align with Missions page UX).

## Verification

- With zero active missions, Active Missions section still appears with empty copy.
- Singles/multistop partitioning and modal behaviors unchanged from functional plan above.

### Todos

- [ ] Partition helper + `{ active, history }`
- [ ] AmrMissions: mixed active rows + **always render** Active section + empty state
- [ ] AmrDashboard: partition + active card (always visible + empty state optional but preferred)
