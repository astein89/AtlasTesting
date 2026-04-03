# DC Automation — Upgrade Instructions

Use this guide to upgrade an existing DC Automation installation to a newer version.

**Breaking changes (URLs, DB filename, PM2/npm name):** see **[MIGRATION_DC_AUTOMATION.md](MIGRATION_DC_AUTOMATION.md)** and [CHANGELOG.md](../CHANGELOG.md).

---

## Before You Start

- **Back up the database** — Your data is in **`dc_automation.db`** (or **`atlas.db`** if you have not migrated yet). Copy it before upgrading.
- **Note your setup** — Port, PM2 config (`dc-automation`), base path (BASE_PATH / VITE_BASE_PATH) and whether you use a reverse proxy, and any custom changes.

---

## Upgrade on Raspberry Pi

### Step 1: Back up the database

```bash
cd ~/dc-automation
cp dc_automation.db dc_automation.db.backup.$(date +%Y%m%d-%H%M%S)
# Legacy filename: cp atlas.db atlas.db.backup.$(date +%Y%m%d-%H%M%S)
```

### Step 2: Stop the app

```bash
pm2 stop dc-automation
```

### Step 3: Get the new code

**From Git:**

```bash
git pull origin main
```

**From another machine (rsync):**

On your development machine:

```bash
rsync -avz --exclude node_modules --exclude dc_automation.db --exclude atlas.db ./dc-automation/ pi@<pi-ip>:~/dc-automation/
```

**From USB or other transfer:**

Copy the new project files over the existing folder, but **do not overwrite** `dc_automation.db` (or `atlas.db` if not yet renamed) or `node_modules`.

### Step 4: Install dependencies

**If building on the Pi:**

```bash
cd ~/dc-automation
npm install
```

**If you built on your dev machine and copied `dist`:**

```bash
cd ~/dc-automation
npm install --omit=dev
```

### Step 5: Build (if building on the Pi)

```bash
npm run build
```

If you use a base path (e.g. http://\<pi-ip\>/dc-automation behind a reverse proxy), build with the same value: `VITE_BASE_PATH=/dc-automation npm run build` (or set `VITE_BASE_PATH` in a `.env` file and source it before building).

Skip this step if you copied a pre-built `dist` folder.

### Step 6: Start the app

```bash
pm2 start dc-automation
# or, if it was deleted from PM2:
pm2 start ecosystem.config.cjs
```

### Step 7: Verify

```bash
pm2 status
pm2 logs dc-automation
```

Open the app in a browser at its URL (http://\<pi-ip\>:3000 or http://\<pi-ip\>/dc-automation if using a reverse proxy) and confirm **Home**, **Testing**, and **Locations** load.

---

## Quick Upgrade (single command)

If you use Git and build on the Pi, you can run the control script:

```bash
cd ~/dc-automation
./scripts/ctl.sh update
```

When using a base path, ensure `VITE_BASE_PATH` is set when building (e.g. in a `.env` file in the project root; the update script sources it before building). See [Raspberry Pi Install & Setup](RASPBERRY_PI_SETUP.md) for the full base-path and reverse-proxy setup.

Or the same steps manually:

```bash
cd ~/dc-automation
cp dc_automation.db dc_automation.db.backup.$(date +%Y%m%d-%H%M%S)
pm2 stop dc-automation
git pull origin main
npm install
npm run build
pm2 start dc-automation
```

If you installed a [system-wide command](SYSTEM_COMMANDS.md), you can run `atlas-ctl update` from anywhere.

---

## Rollback (if something goes wrong)

If the upgrade fails:

```bash
# 1. Restore the database backup
cd ~/dc-automation
cp dc_automation.db.backup.YYYYMMDD-HHMMSS dc_automation.db

# 2. Revert code (if using Git)
git checkout <previous-commit-or-tag>

# 3. Rebuild and restart
npm install
npm run build
pm2 restart dc-automation
```

---

## Database Location

The database file **`dc_automation.db`** is stored in the **project root** (e.g. `~/dc-automation/dc_automation.db`), not inside `dist/`. This ensures it survives `npm run build`, which recreates the `dist/` folder.

If you previously lost data on upgrade, the database may have been stored in `dist/` by an older version. Restore from your backup (see Rollback above).

## Database Schema Migrations

If a release includes schema changes, migrations run automatically when the app starts. No manual steps are needed.

If you see errors about missing columns or tables, check the release notes for that version. You may need to run a specific migration or restore from backup.

---

## Checklist

- [ ] Database backed up
- [ ] App stopped
- [ ] New code copied
- [ ] Dependencies installed
- [ ] Build completed (or `dist` copied)
- [ ] App started
- [ ] App accessible and working
- [ ] Old backup kept until you're sure the upgrade is stable
