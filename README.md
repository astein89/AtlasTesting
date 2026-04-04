# DC Automation

Web app for test automation. After sign-in, the **home** page links into **Testing** (test plans, results, fields, admin) and **Locations**. Define tests with flexible data fields, collect data manually (mobile-friendly), export to CSV, and manage users with admin capabilities.

## Quick Start

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001
- Default login: **admin** / **admin**

## Scripts

- `npm run dev` - Run frontend + backend (concurrently)
- `npm run build` - Build for production
- `npm start` - Run production server (after build)
- `npm run db:seed` - Run DB seed manually (optional)
- App control (start/stop/status/update): see **[System commands](docs/SYSTEM_COMMANDS.md)**.

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

## Tech Stack

- React 18 + Vite + Tailwind CSS
- Express + SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3))
- JWT auth, Zustand, react-hook-form, zod

**Native module:** `better-sqlite3` ships prebuilt binaries for some Node + OS pairs; otherwise it compiles with `node-gyp`.

### Troubleshooting: `Could not locate the bindings file` (Windows)

1. **Prefer Node 20 LTS** (prebuilds are more likely than on Node 22/24). With [nvm-windows](https://github.com/coreybutler/nvm-windows) or similar: `nvm install 20`, `nvm use 20`, then delete `node_modules/better-sqlite3` and run `npm install` again (or `npm rebuild better-sqlite3`).
2. **Or compile locally:** install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload, then run `npm rebuild better-sqlite3`.
3. **Or** use **WSL2** or develop on the Pi/Linux where `build-essential` is enough.

Avoid `npm install --ignore-scripts` for normal dev; it skips the native build.

### Troubleshooting: Vite `EBUSY` / `resource busy` (repo in Dropbox)

Dropbox can lock folders while Vite renames its dependency cache. The dev server stores that cache under your user profile (e.g. `%LOCALAPPDATA%\\dc-automation-vite-cache` on Windows), not inside the repo, to avoid this. If you still see `EBUSY`, exclude the repo’s `.vite` from sync (leftover from older setups), pause Dropbox while running `npm run dev`, or move the repo outside Dropbox.
