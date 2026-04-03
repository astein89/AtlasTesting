# Migrating to DC Automation (breaking changes)

This document lists **operator-facing breaking changes** when moving from **Automation Testing** (`automation-testing`, `atlas.db`, flat SPA routes) to **DC Automation** (`dc-automation`, `dc_automation.db`, multi-module URLs).

Use it together with [UPGRADE.md](UPGRADE.md).

---

## 1. Product and package identity

| Old | New |
| --- | --- |
| Product name “Automation Testing” | **DC Automation** |
| npm package name `automation-testing` | **`dc-automation`** |
| PM2 process name `automation-testing` | **`dc-automation`** |

After pulling new code, recreate the PM2 process if needed:

```bash
pm2 delete automation-testing   # if it still exists
pm2 start ecosystem.config.cjs
pm2 save
```

---

## 2. Default database file

| Old | New |
| --- | --- |
| `atlas.db` (default) | **`dc_automation.db`** |

**One-time migration (project root):**

1. Stop the app (`pm2 stop dc-automation` or equivalent).
2. If you still have only `atlas.db`:  
   `mv atlas.db dc_automation.db`  
   (or `cp` if you prefer to keep a copy under the old name).
3. If you use `DB_PATH`, point it at the new file (or keep a symlink).
4. Start the app.

Backup scripts and cron jobs should reference **`dc_automation.db`** (or your `DB_PATH`).

---

## 3. URL structure (SPA)

The app now uses a **module hub** at `/` and nests workflows:

| Area | New path prefix |
| --- | --- |
| Testing (dashboard, test plans, results, fields, users, settings, admin DB) | **`/testing/...`** |
| Locations | **`/locations/...`** (unchanged segment names after that) |
| Login | `/login` (unchanged) |
| API | **`/api/...`** (unchanged) |

**Examples:**

- `/test-plans` → `/testing/test-plans`
- `/results` → `/testing/results`
- `/fields` → `/testing/fields`
- `/users`, `/settings`, `/admin/db` → `/testing/users`, `/testing/settings`, `/testing/admin/db`

**Bookmarks:** The production server sends **302 redirects** from the old paths to the new ones. Update bookmarks when convenient.

---

## 4. Reverse proxy / base path examples

The [Raspberry Pi setup](RASPBERRY_PI_SETUP.md) guide now assumes the app is served at **http://\<host\>/** (site root). Subpath examples (e.g. **`/dc-automation`**) are optional for multiple apps or legacy URLs.

Documentation still uses **`/dc-automation`** as the **subpath** example (instead of `/automation-testing`). If you deploy under a path:

- Build with e.g. `VITE_BASE_PATH=/dc-automation npm run build`
- Set `BASE_PATH=/dc-automation` in PM2 when the Node app sees the full path (see [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md))
- Update nginx/Caddy `location` blocks to match your chosen path

You may keep **`/automation-testing`** as your real URL; set `VITE_BASE_PATH` and `BASE_PATH` to that value and adjust proxy rules—only the **example** in docs changed to `dc-automation`.

---

## 5. Clone directory and backup paths

Examples may use a clone directory name **`dc-automation`** instead of `automation-testing`. Rename the folder if you want consistency, or keep the old directory name—**it is optional**. What matters is `DB_PATH`, PM2 `cwd`, and proxy paths.

Dropbox/rclone backup paths in examples may show `Backups/dc-automation/sqlite`; update to match your remote layout.

---

## 6. Checklist

- [ ] Back up `atlas.db` or `dc_automation.db` before changes
- [ ] Rename default DB to `dc_automation.db` (or set `DB_PATH`)
- [ ] PM2: switch to app name **`dc-automation`**, fix `cwd` if the repo moved
- [ ] Rebuild client with correct `VITE_BASE_PATH`
- [ ] Adjust reverse proxy paths if you adopt `/dc-automation` (or keep old path with matching env)
- [ ] Update bookmarks to `/testing/...` and `/locations/...` (optional; redirects help)
- [ ] Update backup/cron scripts for new DB filename and paths

---

## 7. Port 80

Typical setup: **Caddy 2** (or nginx) on port **80** proxies to Node on **3000**, so users open **http://\<pi-ip\>/**. Alternatively run Node with `PORT=80` and appropriate permissions. See [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md).
