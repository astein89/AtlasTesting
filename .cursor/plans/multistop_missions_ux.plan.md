---
name: Multistop missions UX and readable mission view
overview: Group multistop segments, readable mission modal, and surface “needs attention” multistop sessions via a global banner and clear list styling; optional lightweight server endpoint for attention list.
todos:
  - id: util-group
    content: Add amrMultistopDisplay.ts — groupByMultistopSession + rollup from latest segment
    status: pending
  - id: api-attention
    content: "GET endpoint: list multistop sessions in attention states (at least awaiting_continue) for banner + list"
    status: pending
  - id: banner-layout
    content: AmrAttentionBanner in Layout (below Navbar) — poll, link to Missions, dismiss optional
    status: pending
  - id: missions-table
    content: Wire AmrMissions grouped rows + attention highlight; preserve trackedJobCodes from all flat rows
    status: pending
  - id: dashboard
    content: Apply grouping to AmrDashboard recent missions slice; optional attention hint
    status: pending
  - id: modal-glossary-actions
    content: AmrMissionDetailModal — Add Stop vs Continue glossary, section/button labels, ordering for Continue block
    status: pending
  - id: modal-human-readable
    content: AmrMissionDetailModal — human labels, section reorder, soften jargon (fleet/worker/internal ID)
    status: pending
  - id: optional-new-copy
    content: Light terminology alignment on AmrMissionNew if needed
    status: pending
isProject: false
---

# Multistop grouping + human-readable mission viewing

## A. Group multistop rows (unchanged intent)

- Raw API returns **one `amr_mission_records` row per segment**. Build [`src/utils/amrMultistopDisplay.ts`](src/utils/amrMultistopDisplay.ts) to group by `multistop_session_id`, **`head` = step index 0**, rollup **`last_status` / tracking / finalized** from **latest** segment (max step index).
- [`AmrMissions.tsx`](src/routes/amr/AmrMissions.tsx): one table row per group; badge like **Multi-stop · N segments**. **`trackedJobCodes`** must still collect **every** segment `job_code` from **ungrouped** `rows` for fleet dedup.
- [`AmrDashboard.tsx`](src/routes/amr/AmrDashboard.tsx): same grouping before recent slice.

## B. Clearer Add Stop vs Continue

In [`AmrMissionDetailModal.tsx`](src/components/amr/AmrMissionDetailModal.tsx):

- Short callout: **Add Stop** = multiple destinations when **creating** a mission; **Continue** = **this screen’s action** to submit the **next fleet segment** after the robot finishes the previous one (`awaiting_continue`).
- Rename primary action to e.g. **Continue to next stop** plus one muted line of explanation; group **Save destination plan** under **Before continuing** where helpful.

## C. Mission viewing cleanup (human-readable)

All scoped to the mission detail modal unless noted; keep monospace only for codes/refs.

### Labels (replace internal jargon where possible)

| Current | Direction |
|--------|-----------|
| Worker tracking | **Tracking** or **Background updates** — values stay Open/Closed or friendlier **Active** / **Stopped** if accurate |
| Fleet complete (status 30 / 35) | **Fleet complete** — optional subtle hint only if needed for support |
| Container out done | **Removed from map** or **Container cleared at node** (match fleet meaning) |
| Persistent container | **Stays on robot** / **Persistent load** (short) |
| This record route | **Route for this leg** or **Stops (this segment)** — clarify it’s this DB row’s two-node payload, not the whole chain when multistop |
| Fleet missions (segments) | **Segments** or **Each fleet job** — plain language |
| Session status `awaiting_continue` | Title-case phrase → **Waiting for next step** (map known session statuses in one helper) |
| Internal ID | Move to **Technical details** collapsed/disclosure at bottom, or smaller footer |

### Layout / hierarchy

1. **Summary strip** (keep): job/mission code + status badges + type + multi-stop/session chip.
2. **Multi-stop block** (when session): pickup, segment list with readable lines (**Stop 1 of N**, job code secondary), then Continue area.
3. **This segment’s route** (rename from “This record route”): ordered stops from payload `missionData`.
4. **Container placement** (rename “Container in”): initial placement sentence.
5. **Details** table (rename section): container, final stand, dates, created by — use friendly labels above.
6. **Technical**: internal record id (and session UUID only if needed for support).

### Multistop segment lines

- Prefer **Stop {n+1} of {total}** with optional monospace job code, rather than only “Step 0: DCA-…”.

### Missions list (light touch)

- After grouping, row text should read as **one mission**; optional tooltip on **Tracking** / **Fleet complete** columns if headers stay short.

### Dashboard recent table

- Same grouped row presentation; ensure columns remain scannable (no raw jargon in cells).

## D. Missions that need attention (visible everywhere)

### Definition (v1)

- **Primary:** multistop session with `status === 'awaiting_continue'` — operator must **Continue** (or adjust plan) on Missions.
- **Optional same banner:** `status === 'failed'` (if present in DB) so failed multi-stop runs are not ignored. Confirm against [`amr_multistop_sessions`](server/routes/amr.ts) enum in code.

### Data loading (avoid N+1 in the shell)

- Add a small **read-only** route, e.g. `GET /amr/dc/missions/attention` (or `/amr/dc/missions/multistop/attention`), auth + `module.amr` (or `amr.missions.manage` for parity with create), returning e.g. `{ count: number, items: Array<{ sessionId, status, pickupPosition?, containerCode?, nextSegmentIndex?, totalSegments? }> }` from a direct query on `amr_multistop_sessions` (`WHERE status IN ('awaiting_continue', 'failed')` or as decided), **limit** e.g. 50.
- Client: **no** per-session `getAmrMultistopSession` from Layout for the banner.

### Global banner

- New component, e.g. [`src/components/amr/AmrAttentionBanner.tsx`](src/components/amr/AmrAttentionBanner.tsx), rendered in [`Layout.tsx`](src/components/layout/Layout.tsx) **immediately below** [`Navbar`](src/components/layout/Navbar.tsx) (full-width strip inside the same root column, above `<main>`), so it appears for **all** app routes when the user has permission.
- **Only render** if user can use AMR missions (`module.amr` or stricter if you want only operators with `amr.missions.manage` — default: same as Missions page read).
- Content: short copy, e.g. **“N multi-stop mission(s) waiting for you to continue”** (or include failed count separately), **link** to [`amrPath('missions')`](src/lib/appPaths.ts) (optional `?attention=1` if the Missions page implements a filter).
- **Poll** on an interval (e.g. 15–30s, or align with existing mission poll from settings) with abort on unmount; **hide** when `count === 0`.
- Styling: high-visibility but not error-red by default (e.g. amber/warning border or brand primary strip) so it reads as **action needed**, not system error.

### Missions list + dashboard

- **Grouped row** for a session in an attention state: add **strong visual** (left border, background tint, or **Needs attention** pill) using session status from attention endpoint or by merging attention `sessionId` set into the rows after grouping.
- Optional: **sort** attention missions to the top when query param or toggle **“Attention first”** is on.

## E. Optional follow-up (out of scope unless quick)

- Structured editor for destinations instead of raw JSON — **not** required for this pass.

## Testing

- 3-stop mission → one grouped row; statuses roll up from latest segment; fleet dedup still correct.
- Modal: statuses/read copy OK for rack-only and multistop; Continue still works.
- Dashboard recent list not duplicated per segment.
- With a session in `awaiting_continue`: banner shows correct count on **non-AMR** routes too; link opens Missions; list highlights that mission group.
