---
name: AMR MultiStop missions
overview: Replace the current “add arbitrary stops → one submitMission” flow with the MultiStop model from docs/AMR/AMR_MultiStop.md, including mid-mission edit of remaining destinations.
todos:
  - id: schema-session
    content: Add amr_multistop_sessions + amr_mission_records FK columns in SQLite + PG + migrate-sqlite-to-pg
    status: completed
  - id: api-multistop
    content: Implement POST multistop start, POST continue, PATCH plan; restrict rack-move to missionData length 2
    status: completed
  - id: worker-multistop
    content: "Mission worker: skip containerOut on non-final multistop steps; persist robotId to session; session state awaiting_continue"
    status: completed
  - id: ui-new-mission
    content: Replace AmrMissionNew legs + Add stop with pickup + destination chain + API wiring
    status: completed
  - id: ui-missions-continue
    content: "AmrMissions / AmrMissionDetailModal: multistop badge, all steps, Continue + PATCH edit while waiting"
    status: completed
isProject: false
---

# AMR MultiStop (replace single-shot multi-leg rack move)

## Fleet contract — `lockRobotAfterFinish`

Use **string booleans** only:

- **`"true"`** — intermediate MultiStop segments (more segments remain after this `submitMission`).
- **`"false"`** — single-segment rack moves (simple two-node mission) **and** the **final** segment of a MultiStop chain.

Do not rely on empty string for “unlock”; align server forwarding and UI previews with **`"false"`** when locking is off.

## What exists today

- [`src/routes/amr/AmrMissionNew.tsx`](src/routes/amr/AmrMissionNew.tsx) builds **one** `missionData` array with **N** `NODE_POINT` rows and posts **`POST /amr/dc/missions/rack-move`** ([`server/routes/amr.ts`](server/routes/amr.ts)). The server runs **one** `containerIn` and **one** `submitMission` with the full array. `lockRobotAfterFinish` / `unlockRobotId` are passed through if present but the UI never sets them.
- [`server/lib/amrMissionWorker.ts`](server/lib/amrMissionWorker.ts) tracks **one** `job_code` per `amr_mission_records` row; on terminal success it may call **`containerOut`** when not persistent.

## What [`docs/AMR/AMR_MultiStop.md`](docs/AMR/AMR_MultiStop.md) requires

- Same fleet calls: `containerIn` → `submitMission` → `jobQuery` → `containerOut` (only at the end).
- Per-segment `submitMission`: each mission is a **Start → End** pair (`sequence` 1 and 2 in `missionData`).
- Non-final segments: **`lockRobotAfterFinish: "true"`**; final segment: **`lockRobotAfterFinish: "false"`**.
- After the first segment: obtain **`robotId`** from `jobQuery` and pass as **`unlockRobotId`** on subsequent `submitMission` calls.
- Only one `containerIn`; only `containerOut` after the last segment (unless persistent).
- UX: MultiStop badge; waiting + **Continue**; **add/change** future destinations while waiting; show all parts of the run.

## Target architecture

```mermaid
sequenceDiagram
  participant UI
  participant DC as DC_amr_routes
  participant Fleet
  participant W as mission_worker

  UI->>DC: POST multistop start (pickup, dest chain...)
  DC->>Fleet: containerIn once
  DC->>Fleet: submitMission seg1 (lock "true" if more segments)
  DC-->>UI: session id + first mission record

  loop Poll
    W->>Fleet: jobQuery
    W->>W: on success: if not final multistop step, skip containerOut; store robotId; session=awaiting_continue
  end

  UI->>DC: PATCH session (edit remaining stops) optional
  UI->>DC: POST continue
  DC->>Fleet: jobQuery (safety) + submitMission next seg (unlockRobotId; lock "true" or "false" by segment)
  Note over W: final segment success then containerOut if not persistent
```

## Data model (SQLite + PostgreSQL + migrate script)

- **`amr_multistop_sessions`**: container, persistent, orientation, robotIds, plan (ordered destinations + per-segment options), `status`, `current_step_index`, `locked_robot_id`, timestamps, `created_by`.
- **`amr_mission_records`**: add `multistop_session_id`, `multistop_step_index` (and optional `is_multistop_final` or infer from plan).

**Worker:** on terminal success, if not final multistop step → skip `containerOut`, store `robotId` to session, set `awaiting_continue`. Final step → existing `containerOut` rules.

## HTTP API

- **`POST /amr/dc/missions/multistop`**: one `containerIn`, first `submitMission` with `missionData` length 2; `lockRobotAfterFinish: "true"` iff more than one segment, else `"false"`.
- **`POST .../continue`**: `unlockRobotId` from `jobQuery` or session; next segment with `lockRobotAfterFinish: "true"` if not last, else `"false"`.
- **`PATCH .../multistop/:id`**: only while `awaiting_continue`; edit not-yet-run tail of plan.
- **`POST .../rack-move`**: reject `missionData.length !== 2` (single two-node move only).

## Frontend

- **AmrMissionNew**: remove “Add stop” / N-leg single submit; pickup + destination chain; call multistop API.
- **Missions / detail**: multistop badge, all steps, Continue, PATCH for remaining stops.
- **Preview** ([`src/utils/amrRackMoveFleetPreview.ts`](src/utils/amrRackMoveFleetPreview.ts)): use `"true"` / `"false"` strings for lock in examples.

## Emulator

- Optionally teach [`scripts/amr-fleet-emulator.mjs`](scripts/amr-fleet-emulator.mjs) to echo `lockRobotAfterFinish` in logs for debugging; `jobQuery` should still return a stable `robotId` for `unlockRobotId` tests.
