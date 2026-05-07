# DC Automation

Web app for test automation and related operations. After sign-in, the **home** hub links into modular areas: **Testing** (test plans, results, fields), **Locations**, **Wiki**, **Files**, **AMR** (fleet/missions), and **Admin** (users, roles, settings, backup, status). Define tests with flexible data fields, collect data manually (mobile-friendly), export to CSV, and manage users with role-based permissions.

## Quick Start

```bash
npm install
npm run dev
```

- **Frontend (Vite):** http://localhost:5173 — proxies `/api` to the backend
- **Backend (Express):** http://localhost:3001
- **Default login:** **admin** / **admin**

## Scripts

- `npm run dev` — Frontend + backend (`concurrently`)
- `npm run dev:client` / `npm run dev:server` — Run one side only
- `npm run build` — Client build → `dist/`; server compile → `dist/server/`
- `npm start` — Production: serve API + static SPA from `dist/` (run after `npm run build`; requires `NODE_ENV=production`)
- `npm run db:seed` — Run DB seed manually (optional)
- `npm run db:migrate` — SQLite → PostgreSQL migration helper (see docs when upgrading)
- `npm run amr:emulator` — Local AMR fleet emulator for development
- `npm run migrate:uploads-testing` — One-off uploads path migration (see script / ops docs)
- App control (start/stop/status/update): **[System commands](docs/SYSTEM_COMMANDS.md)**

---

## Frontend (`src/`)

| Item | Details |
|------|---------|
| **Stack** | React 18, TypeScript, Vite 6, Tailwind CSS |
| **Routing** | React Router 6 (`src/App.tsx`): SPA with lazy-loaded route modules |
| **State / API** | Zustand (`authStore`), Axios client (`src/api/client.ts`) → `${basePath}/api` |
| **Forms / validation** | react-hook-form, Zod, `@hookform/resolvers` |
| **Path alias** | `@/` → `src/` (see `vite.config.ts`) |

**URL modules (client paths)** — all respect `VITE_BASE_PATH` when the app is deployed under a subpath:

- `/` — Home hub (public; module cards respect permissions when logged in)
- `/links` — Curated links page
- `/testing/...` — Test plans, results, field definitions (permissions: `module.testing`, etc.)
- `/locations/...` — Locations, schemas, zones
- `/wiki/...` — Internal wiki (Markdown / editor)
- `/files/...` — File library and recycle bin
- `/amr/...` — AMR dashboard, missions, robots, settings, API playground
- `/admin/...` — Admin console (status, settings, backup, DB tools, roles, users)
- `/login` — Redirects to `/?login=1`

**Development:** Vite dev server listens on all interfaces (`host: true`), proxies `/api` to `http://127.0.0.1:3001`, and stores its dependency cache outside the repo (see troubleshooting below for Dropbox/`EBUSY`).

**Production client build:** `npm run build:client` outputs to `dist/` (HTML, JS chunks, assets). Set `VITE_BASE_PATH` at build time if the SPA is hosted under a path prefix (must match reverse proxy / `BASE_PATH` on the server).

---

## Backend (`server/`)

| Item | Details |
|------|---------|
| **Stack** | Node.js, Express 4, TypeScript (`tsx` in dev → compiled to `dist/server/` for production) |
| **Entry** | `server/index.ts` |
| **Default port** | `PORT` env or **3001** |
| **API base** | `{BASE_PATH}/api` (`BASE_PATH` empty in dev → `/api/...`) |

**Mounted API routers** (relative to `/api`):

| Prefix | Purpose |
|--------|---------|
| `/health` | Liveness (`{ ok: true }`) |
| `/auth` | Login, refresh, JWT session |
| `/admin` | Admin operations |
| `/fields`, `/test-plans`, `/records` | Testing domain |
| `/users`, `/preferences`, `/roles` | Users and prefs |
| `/upload` | Uploads handling |
| `/uploads` | Static files from `./uploads` (project root) |
| `/locations` | Locations module |
| `/home` | Home hub API |
| `/wiki` | Wiki |
| `/files` | Files library |
| `/settings`, `/backup` | App settings and backup |
| `/amr` | AMR fleet / missions |

**JSON body limit:** Default ~15 MB; override with `JSON_BODY_LIMIT` (e.g. large bulk location payloads).

**Database:**

- **Default:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), file `dc-automation.db` in the project root, or path from `DB_PATH`.
- **Optional PostgreSQL:** Set `DATABASE_URL`, or put `databaseUrl` in `config.json` / `config.default.json` ([`server/config.ts`](server/config.ts)). Helpers such as `npm run db:migrate` support migrating from SQLite.

**Production static files:** After `npm run build`, Express serves the Vite output from `dist/` and falls back to `index.html` for the SPA (with extra handling when `BASE_PATH` is set for subpath hosting).

**Startup side jobs:** Database init/migrations, slug backfills, wiki seed defaults, scheduled file/wiki recycle purge, backup timers, and the AMR mission worker (`startAmrMissionWorker`).

---

## Deployment (Raspberry Pi)

See **[Raspberry Pi Install & Setup Guide](docs/RASPBERRY_PI_SETUP.md)** for detailed instructions.

**Migrating from Automation Testing or upgrading?** See **[MIGRATION_DC_AUTOMATION.md](docs/MIGRATION_DC_AUTOMATION.md)** — **[Start here](docs/MIGRATION_DC_AUTOMATION.md#start-here)** picks the right section. **[UPGRADE.md](docs/UPGRADE.md)** is a short link to the same doc.

**SQLite backups to Dropbox (cron, rclone)?** See **[Backup setup guide](docs/BACKUP_SETUP.md)**.

Quick steps:

1. Install Node.js 18+ and PM2
2. Copy project to Pi; run `npm install --omit=dev`
3. `npm run build`
4. `pm2 start ecosystem.config.cjs`
5. `pm2 startup` + `pm2 save`

**URLs:** Testing screens live under `/testing/...`, Locations under `/locations/...`, home at `/`. To serve on **port 80** at a path (e.g. http://\<pi-ip\>/dc-automation) alongside other apps, set `VITE_BASE_PATH` when building and `BASE_PATH` in PM2 if required, then configure a **reverse proxy** (nginx or Caddy). See the [Raspberry Pi Setup Guide](docs/RASPBERRY_PI_SETUP.md).

Legacy server routes redirect older bookmark paths (for example `/test-plans` → `/testing/test-plans`); see `spaLegacyRedirect` in `server/index.ts`.

---

## Tech Stack (summary)

- **Frontend:** React 18, Vite, Tailwind CSS, React Router 6, Zustand, Axios, react-hook-form, Zod; rich editing (e.g. md-editor-rt), Mermaid, drag-and-drop (`@dnd-kit`), CSV (PapaParse), PDF export helpers (jspdf, html2canvas)
- **Backend:** Express, JWT auth, multipart uploads (multer), optional cron parsing for schedules
- **Data:** SQLite (default) or PostgreSQL (`DATABASE_URL` / config)

**Native module:** `better-sqlite3` ships prebuilt binaries for some Node + OS pairs; otherwise it compiles with `node-gyp`.

### Troubleshooting: `Could not locate the bindings file` (Windows)

1. **Prefer Node 20 LTS** (prebuilds are more likely than on Node 22/24). With [nvm-windows](https://github.com/coreybutler/nvm-windows) or similar: `nvm install 20`, `nvm use 20`, then delete `node_modules/better-sqlite3` and run `npm install` again (or `npm rebuild better-sqlite3`).
2. **Or compile locally:** install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload, then run `npm rebuild better-sqlite3`.
3. **Or** use **WSL2** or develop on the Pi/Linux where `build-essential` is enough.

Avoid `npm install --ignore-scripts` for normal dev; it skips the native build.

### Troubleshooting: Vite `EBUSY` / `resource busy` (repo in Dropbox)

Dropbox can lock folders while Vite renames its dependency cache. The dev server stores that cache under your user profile (e.g. `%LOCALAPPDATA%\dc-automation-vite-cache` on Windows), not inside the repo, to avoid this. If you still see `EBUSY`, exclude the repo’s `.vite` from sync (leftover from older setups), pause Dropbox while running `npm run dev`, or move the repo outside Dropbox.
