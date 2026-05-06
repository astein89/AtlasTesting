---
name: AMR mission templates
overview: Org-wide named mission templates (shared library) with REST API and UI. Templates nest under the Missions sidebar group alongside the missions list; mission creation retains load/save from the form.
todos:
  - id: db-schema
    content: Add amr_mission_templates table (SQLite + PG + migrate-sqlite-to-pg)
    status: completed
  - id: api-routes
    content: Implement GET/POST/PUT/DELETE mission-templates in server/routes/amr.ts with validation + permissions split
    status: completed
  - id: client-api
    content: Add template CRUD helpers in src/api/amr.ts
    status: completed
  - id: sidebar-nav
    content: Nest Missions group in Sidebar — Overview (/amr/missions) + Templates (/amr/missions/templates); active states for missions subtree
    status: completed
  - id: templates-page
    content: New route + AmrMissionTemplates page for list/rename/delete (amr.missions.manage); optional deep-link from mission form
    status: completed
  - id: mission-new-ui
    content: Template load/save on AmrMissionNew + apply/snapshot helpers
    status: completed
isProject: false
---

# AMR mission templates (shared library)

## Context

- Mission creation lives in [`src/routes/amr/AmrMissionNew.tsx`](src/routes/amr/AmrMissionNew.tsx): React state (`legs`, `containerCode`, `persistent`, `selectedRobotIds`) and submit via [`createMultistopMission`](src/api/amr.ts) + [`buildMultistopPayload()`](src/routes/amr/AmrMissionNew.tsx). The UI uses this path for **both** two-stop and three-plus-stop routes.
- Dedicated [`POST /amr/dc/missions/rack-move`](server/routes/amr.ts) exists but is **not** wired from the UI; templates use **one canonical payload** mirroring the form / `buildMultistopPayload` inputs.

## Sidebar navigation (required)

Nest **Templates** under **Missions** in [`src/components/layout/Sidebar.tsx`](src/components/layout/Sidebar.tsx) (AMR block):

- Replace the single flat `NavLink` to `amrPath('missions')` with a **Missions group**:
  - **Overview** (or **Mission list**) → `amrPath('missions')` — same destination as today’s missions page.
  - **Templates** → `amrPath('missions', 'templates')` — dedicated templates management page (`/amr/missions/templates`).
- Style the child link with left indent / muted text consistent with nested items elsewhere (or match Wiki/files subtree patterns if any).
- **Active state**: highlight appropriately when `pathname` is under the missions subtree — e.g. `/amr/missions`, `/amr/missions/new`, `/amr/missions/templates` (use `NavLink` `isActive` with `pathname.startsWith` or a small helper so query strings on `/amr/missions` still count).

Register the route in [`src/App.tsx`](src/App.tsx) next to existing AMR routes: lazy-load e.g. `AmrMissionTemplates` at `path="missions/templates"`.

This replaces the earlier optional idea of burying template management only under **Settings**; management stays primary under **Missions → Templates**, while **Save as template / Load template** controls remain on the mission creation form.

## Data model

New table **`amr_mission_templates`** (SQLite in [`server/db/schema.ts`](server/db/schema.ts), Postgres in [`server/db/schema-pg.ts`](server/db/schema-pg.ts), include in [`scripts/migrate-sqlite-to-pg.ts`](scripts/migrate-sqlite-to-pg.ts)):

| Column | Purpose |
|--------|---------|
| `id` TEXT PK | uuid |
| `name` TEXT NOT NULL | **Globally unique** org-wide label (trimmed); unique index |
| `payload_json` TEXT NOT NULL | Versioned JSON (below) |
| `created_by` TEXT | FK `users(id)`, audit |
| `created_at` / `updated_at` TEXT | ISO timestamps |

**Payload (`payload_json`) — v1**

```ts
{
  version: 1,
  legs: Array<{
    position: string
    putDown: boolean
    continueMode?: 'manual' | 'auto'
    autoContinueSeconds?: number
  }>,
  persistentContainer: boolean,
  robotIds: string[],
  containerCode?: string
}
```

Derive “two-stop vs multi-stop” from `legs.length`. On apply in UI, map to `newLeg()` for fresh `id`s.

## HTTP API

Inside [`server/routes/amr.ts`](server/routes/amr.ts):

| Method | Path | Permission |
|--------|------|------------|
| GET | `/dc/mission-templates` | `module.amr` |
| GET | `/dc/mission-templates/:id` | `module.amr` |
| POST | `/dc/mission-templates` | `amr.missions.manage` |
| PUT | `/dc/mission-templates/:id` | `amr.missions.manage` |
| DELETE | `/dc/mission-templates/:id` | `amr.missions.manage` |

Validate payload on write (mirror [`validateNewMissionForm`](src/routes/amr/AmrMissionNew.tsx) rules).

## Client

- [`src/api/amr.ts`](src/api/amr.ts): list/get/create/update/delete helpers.
- **Templates page** [`src/routes/amr/AmrMissionTemplates.tsx`](src/routes/amr/AmrMissionTemplates.tsx) (new): table or card list of templates, rename + delete for `amr.missions.manage`; read-only list hint for others if desired.
- [`src/routes/amr/AmrMissionNew.tsx`](src/routes/amr/AmrMissionNew.tsx): fetch templates; load/save controls; link “Manage templates” → `amrPath('missions', 'templates')`.

## Testing

- Sidebar shows Missions → Overview + Templates; `/amr/missions/templates` renders management UI.
- Save/load from new mission page; duplicate name → 409.
