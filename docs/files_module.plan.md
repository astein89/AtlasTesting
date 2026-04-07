---
name: Files module (upload, download, view, folders)
overview: Files module with explorer-like UI (tree, breadcrumbs, list/grid/details views, sort), folders, flat disk storage, module.files + per-file ACL.
todos:
  - id: perm-schema
    content: module.files, optional files.manage; file_folders + stored_files; role seed
  - id: acl-helper
    content: server/lib/fileAccess.ts — ACL helper + uploader/admin override
  - id: api-folders
    content: Folder CRUD + tree/parent listing; cycle/empty rules
  - id: api-files
    content: GET files by folderId + optional sortBy/sortOrder; upload, view, download, move, ACL PUT, DELETE
  - id: client-module
    content: appPaths, modules, routes, Sidebar shell for /files
  - id: client-explorer
    content: Explorer layout — folder tree + main pane, breadcrumbs, view mode + sort controls, persist prefs (user_preferences or localStorage)
  - id: client-viewers
    content: Preview panel/modal — images, PDF blob+iframe, text; Download
  - id: client-acl
    content: Upload/edit ACL (roles + permission)
isProject: false
---

# Files module (upload, download, view, folders)

## Goals

- New module **`files`**: **file-explorer-style UI** (navigation + **multiple view and sort modes**) over **folders** and files: **list / upload / download / preview** where applicable.
- **Per-file permissions** as below.
- **On-disk layout stays flat**; hierarchy is **DB-only** under `uploads/files/<uuid>…`. (The **Testing** module’s image field uploads today use **`uploads/testing/`** and URLs **`/api/uploads/testing/…`**, separate from the future Files module directory.)

## File explorer UX (client)

Target: behavior and density similar to a **desktop file manager** (Windows Explorer / Finder-style patterns), adapted to the web.

**Layout**

- **Left**: **folder tree** (collapsible), sync’d with current location; optional resize split pane on desktop.
- **Main**: **breadcrumb** trail (root → … → current folder) with clickable segments; **toolbar** above the item area.
- **Current folder** shows **subfolders** and **files** together in one pane (folders first or mixed with type sort — document choice; default **folders first**, then files).

**View modes** (toolbar toggle or icon buttons; persist user choice)

| Mode | Behavior |
|------|----------|
| **List / details** | Row per item; columns at least **Name**, **Date modified**, **Size** (files), **Type** (category: image, PDF, …); optional **Kind** column for folder vs file. Match existing app table styling. |
| **Grid / icons** | Large tiles: **thumbnail** for image MIME types (lazy-load preview via authenticated fetch or tiny placeholder + icon); **generic type icons** for PDF, text, other. Folders show folder icon. |
| **Compact list** (optional v1.1) | Dense single column — smaller rows for long directories. |

**Sort options** (toolbar: primary sort + **asc/desc** toggle)

- **Name** (locale-aware string compare on display name).
- **Date modified** (`created_at` or future `updated_at` if added — document single field).
- **Size** (folders sort 0 or after files — document).
- **Type** (extension or coarse category from `mime_type`).

Implementation options:

- **Preferred**: **`GET /api/files`** accepts **`sortBy`** + **`order`** (`asc` | `desc`) so large folders stay correct and paginated later.
- **Acceptable MVP**: fetch unsorted + **sort client-side** if product limits folder size; still **persist** sort key/order in UI.

**Persistence**

- Store **view mode**, **sort key**, and **sort direction** in **[user_preferences](server/db/schema.ts)** (per user, cross-device) or **`localStorage`** fallback — align with how other modules store UI prefs in this app.

**Interactions**

- **Double-click / Open** folder → navigate; **Open** file → preview if supported else download.
- **Context menu** optional v1.1; minimal v1: row actions **Open**, **Download**, **Delete** (if allowed), **Move** (picker).
- **Keyboard** optional: Arrow + Enter — note as polish.

## Folders vs files

| | Folders | Files |
|--|--------|--------|
| Storage | **`file_folders`** (`parent_id` self-FK, nullable = root) | **`stored_files`** + binary on disk |
| Naming | **`name`** unique among **siblings**; **case-insensitive** uniqueness recommended | `original_filename` + `storage_filename` |
| ACL | **v1**: none on folder; files only | `allowed_role_slugs`, `required_permission` |

**Delete / move rules**

- **Delete folder**: **empty** only (no child folders, no files with this `folder_id`) → else **409**.
- **Move folder**: update `parent_id`; **reject cycles**.

## Module gate vs per-file ACL

1. **`module.files`**: all **`/api/files/*`** routes.
2. **Per-file rules**: filter list and gate **view/download/delete**.

## Per-file access model (home links)

| `allowed_role_slugs` | `required_permission` | Access |
|---------------------|------------------------|--------|
| Non-empty JSON | — | At least one role slug matches. |
| Empty / null | Non-empty | `hasPermission(key)`. |
| Empty / null | Empty / null | Anyone with `module.files`. |

**Overrides**: uploader + full admin `*`.

**Helper**: `fileAccessibleToUser` in `server/lib/`.

## Permissions (catalog)

- **`module.files`**, optional **`files.manage`**.

## Data model

**`file_folders`**: `id`, `parent_id`, `name`, `created_at`, optional `created_by`; sibling name uniqueness.

**`stored_files`**: plus **`folder_id`** FK; ACL columns.

Migrations: [server/db/schema.ts](server/db/schema.ts).

## Server API

[server/routes/files.ts](server/routes/files.ts): `authMiddleware` + `requirePermission('module.files')`.

**Folders**: `GET` (by parent / tree), `POST`, `PATCH`, `DELETE` if empty.

**Files**

- **`GET /`**: `folderId`, optional **`sortBy`** (`name` | `date` | `size` | `type`), **`order`** (`asc` | `desc`); apply **`fileAccessibleToUser`**; default sort **`date desc`** if unspecified.
- **`POST /`**, **`GET /:id/view`**, **`GET /:id/download`**, **`PUT /:id`**, **`DELETE /:id`** as before.

**Listing note**: May hide folder nodes with no visible files for a user (optional; harder query).

## Preview (file types)

| Pattern | MIME | UI |
|--------|------|-----|
| Images | `image/*` | Lightbox / side preview |
| PDF | `application/pdf` | Blob + iframe |
| Text | `text/plain`, `text/markdown`, `text/csv` | `<pre>` / light markdown |

**Fetch + Bearer → Blob URL** for inline display.

## Security

- Flat disk; no user paths on FS; all bytes via **`/api/files`** + ACL.

## Testing

- Explorer: switch list ↔ grid; change sort; refresh; prefs survive reload (if persisted).
- Folders + ACL behavior unchanged from prior plan.
