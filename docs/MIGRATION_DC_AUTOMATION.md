# DC Automation — migration and upgrades

This document covers two separate jobs:

| Job | When | Section |
| --- | --- | --- |
| **Migration** | You still run **Automation Testing** and want **DC Automation** | [Migration](#migration-from-automation-testing) (one time) |
| **Upgrade** | You already run **DC Automation** and want newer **git** code | [Upgrades](#upgrades-after-you-use-dc-automation) (repeat as needed) |

**Related docs:** [CHANGELOG.md](../CHANGELOG.md) · [Raspberry Pi install](RASPBERRY_PI_SETUP.md) (first-time server, Caddy/nginx, port 80).

### How to read this guide

1. Use **[Start here](#start-here)** to pick migration vs upgrade — do **not** mix the two procedures in one session.
2. If migrating, skim **[What changes](#what-changes-one-time)** so names and paths make sense, then complete **[Migration](#migration-from-automation-testing)** once.
3. If upgrading, skip migration and follow **[Upgrades](#upgrades-after-you-use-dc-automation)** only.
4. Use **[Checklists](#checklists)** at the end to verify you did not miss backup, PM2, or cron paths.

---

## Start here

| You are… | Do this |
| --- | --- |
| **Still on Automation Testing** and moving to DC Automation | Read **[What changes](#what-changes-one-time)**, then **[Migration](#migration-from-automation-testing)** — choose **Route 1** or **Route 2** and follow that route’s steps in order. |
| **Already on DC Automation** and only updating code | Go straight to **[Upgrades](#upgrades-after-you-use-dc-automation)**. |

---

## What changes (one time)

| | Old | New |
| --- | --- | --- |
| Folder name (typical) | `automation-testing`, `AutomationTesting` | **`dc-automation`** |
| PM2 process | `automation-testing` | **`dc-automation`** |
| npm package `name` | `automation-testing` | **`dc-automation`** |
| SQLite file | `atlas.db` | **`dc-automation.db`** (in **project root**, not inside `dist/`; legacy **`dc_automation.db`** is still opened if the hyphenated file is missing) |
| App URLs | `/test-plans`, … | **`/testing/...`**, **`/locations/...`**, home **`/`** — old paths may **302 redirect** |

---

## Migration from Automation Testing

**Before anything:** copy **`atlas.db`** or **`dc-automation.db`** to a safe backup with a date in the filename. Note your PM2 name, project path, and reverse proxy.

### Pick a route

| Route | Use when |
| --- | --- |
| **[Route 1](#migration-route-1)** — fresh `git clone` | New machine, clean folder, or you prefer a side‑by‑side copy before deleting the old tree. |
| **[Route 2](#migration-route-2)** — rename folder | Same machine; you want to **rename** the existing project directory in place (`mv` + `git pull`). |

Both routes end with the same **install → build → PM2** pattern and the same **[after migration](#after-migration)** checks (URLs, proxy, cron).

<a id="migration-route-1"></a>

### Route 1 — Fresh `git clone` (new folder, typical for a new Pi or clean install)

Do **not** copy **`node_modules`** or **`dist`** from an old tree. Only copy the **SQLite file** (and optionally **`scripts/backup.conf`**). Run **`npm install`** fresh so **better-sqlite3** matches this checkout.

**1.** Clone into **`dc-automation`:**

```bash
cd ~
git clone <your-repo-url> dc-automation
cd ~/dc-automation
```

Use your real URL (HTTPS or SSH).

**2.** Put the database in **`~/dc-automation/`** next to **`package.json`**:

- From an **old install on disk:**  
  `cp /path/to/old/atlas.db ~/dc-automation/dc-automation.db`  
  (or copy `dc-automation.db` if it was already renamed.)
- From a **backup file** (USB, SCP, etc.): copy **`dc-automation.db`** or **`atlas.db`** into **`~/dc-automation/`**.

**3.** If the file is still named **`atlas.db`**, rename it:

```bash
cd ~/dc-automation
mv atlas.db dc-automation.db
```

**4.** Remove old PM2 entries so only the new app will register:

```bash
pm2 stop automation-testing 2>/dev/null || true
pm2 stop dc-automation 2>/dev/null || true
pm2 delete automation-testing 2>/dev/null || true
pm2 delete dc-automation 2>/dev/null || true
```

**5.** Install, build, start:

```bash
cd ~/dc-automation
npm install
npm run build
```

- **Public URL is site root** (`http://<host>/`): plain `npm run build` is enough.
- **Public URL is a subpath** (e.g. `/dc-automation`): use the same `VITE_BASE_PATH` you will use in production, e.g. `VITE_BASE_PATH=/dc-automation npm run build`, or set it in `.env`. Details: [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md).

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

**6.** Open the app (e.g. `http://<pi-ip>:3000` or through your proxy). The first start runs **schema migrations** if the DB is from an older release.

**7.** Optional: add **`scripts/backup.conf`** (copy from the old server or from **`scripts/backup.conf.example`**) and set **`DB_PATH`** to the absolute path of **`dc-automation.db`**.

**8.** When everything works, **archive or delete** the old project folder if it still exists, and fix **cron** / scripts that still mention the old path (`grep -r automation-testing` in `crontab -l` and `/etc/cron*`).

---

<a id="migration-route-2"></a>

### Route 2 — Rename the existing folder (same machine, no new clone)

**1.**

```bash
cd ~
mv automation-testing dc-automation
# Adjust: mv ~/AutomationTesting ~/dc-automation
cd ~/dc-automation
git pull origin main
```

**2.** If the DB is still **`atlas.db`**, rename:

```bash
mv atlas.db dc-automation.db
```

**3.** Same **PM2 cleanup**, **npm install**, **build**, **pm2 start** as Route 1 steps **4–5** (run **`cd ~/dc-automation`** first).

**4.** Same optional **backup.conf**, **retire old paths**, and **cron** cleanup as Route 1 steps **7–8** if applicable.

---

<a id="after-migration"></a>

### After migration — URLs, proxy, ops

**Bookmarks**

| Old | New |
| --- | --- |
| `/test-plans`, `/results`, `/fields`, … | `/testing/...` |
| Locations | `/locations/...` |
| API | `/api/...` (unchanged) |

**Reverse proxy**

- **Site root** on port 80: [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md) (Caddy/nginx → Node :3000).
- **Subpath**: same guide — match `VITE_BASE_PATH` and proxy rules.

**Cron, backups, symlinks**

Update any path that still says `automation-testing` or the old folder:

| Item | Set |
| --- | --- |
| `scripts/backup.conf` | `DB_PATH` = absolute path to `dc-automation.db`; `STAGING_ROOT` e.g. `/var/lib/dc-automation-backup` — see **`scripts/backup.conf.example`** |
| Cron | Paths to `sqlite-dropbox-backup.sh`, `flock`, `BACKUP_CONF` |
| `ctl.sh` symlink | e.g. `sudo ln -sf /home/pi/dc-automation/scripts/ctl.sh /usr/local/bin/autotest` |

**`package.json`:** upstream **`name`** is **`dc-automation`**. Update your fork if it still says **`automation-testing`**.

---

## Upgrades (after you use DC Automation)

Repeat whenever you want a newer version from **git**. Same idea as **Route 1 steps 5** (install → build → pm2), but the project and DB already exist.

### Steps

**1. Back up the database**

```bash
cd ~/dc-automation
cp dc-automation.db dc-automation.db.backup.$(date +%Y%m%d-%H%M%S)
```

**2. Stop the app**

```bash
pm2 stop dc-automation
```

**3. Get new code**

- Git: `git pull origin main`
- Or rsync/USB — do **not** overwrite `dc-automation.db` or blindly overwrite `node_modules`

**4. Dependencies**

```bash
cd ~/dc-automation
npm install
```

(Use `npm install --omit=dev` only if you copied a pre-built `dist` from elsewhere.)

**5. Build** (skip if you copied `dist`)

```bash
npm run build
```

Use the same **`VITE_BASE_PATH`** strategy as in production (root vs subpath).

**6. Start**

```bash
pm2 start dc-automation
# or: pm2 start ecosystem.config.cjs
```

**7. Verify:** `pm2 status`, `pm2 logs dc-automation`, open the app in a browser.

### One-liner (Git + build on the Pi)

```bash
cd ~/dc-automation && ./scripts/ctl.sh update
```

If you get **Permission denied**, run once: **`chmod +x scripts/ctl.sh scripts/pi-update.sh`**. If **`git status`** then shows those files as changed with no real diff, run **`git config core.fileMode false`** in the repo (local only — see [SYSTEM_COMMANDS.md](SYSTEM_COMMANDS.md)).

Or manually: backup DB → `pm2 stop dc-automation` → `git pull` → `npm install` → `npm run build` → `pm2 start dc-automation`.

See [SYSTEM_COMMANDS.md](SYSTEM_COMMANDS.md) for a global `ctl` command.

### Rollback

```bash
cd ~/dc-automation
cp dc-automation.db.backup.YYYYMMDD-HHMMSS dc-automation.db
git checkout <previous-commit-or-tag>
npm install && npm run build
pm2 restart dc-automation
```

### Database location and migrations

**`dc-automation.db`** stays in the **project root** (not inside **`dist/`**), so it survives **`npm run build`**. If you still have only **`dc_automation.db`**, the app uses it until you run **`mv dc_automation.db dc-automation.db`**. Migrations run **automatically** on startup. If you see schema errors, check the release notes for that version.

---

## Production: port 80 (optional)

Serving on **http://\<pi-ip\>/** with **Caddy** or **nginx** on port **80** → Node on **3000**: full examples in **[RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md)**. Switching **nginx → Caddy**: [Migrating from nginx to Caddy 2](RASPBERRY_PI_SETUP.md#migrating-from-nginx-to-caddy-2).

---

## Checklists

**One-time migration**

- [ ] DB backed up
- [ ] Route 1 or Route 2 completed; **`dc-automation.db`** in project root
- [ ] `npm install` + `npm run build` (correct `VITE_BASE_PATH` if using a subpath)
- [ ] PM2: `dc-automation` only, `pm2 save`
- [ ] Proxy / bookmarks / cron / `backup.conf` updated if needed
- [ ] Old `automation-testing` tree removed or archived

**Each upgrade**

- [ ] DB backed up
- [ ] `pm2 stop` → new code → `npm install` → `npm run build` → `pm2 start`
- [ ] App tested before deleting the new `.backup` file
