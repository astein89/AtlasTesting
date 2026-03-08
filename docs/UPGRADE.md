# Automation Testing — Upgrade Instructions

Use this guide to upgrade an existing Automation Testing installation to a newer version.

---

## Before You Start

- **Back up the database** — Your data is in `atlas.db`. Copy it before upgrading.
- **Note your setup** — Port, PM2 config, any custom changes.

---

## Upgrade on Raspberry Pi

### Step 1: Back up the database

```bash
cd ~/automation-testing
cp atlas.db atlas.db.backup.$(date +%Y%m%d-%H%M%S)
```

### Step 2: Stop the app

```bash
pm2 stop automation-testing
```

### Step 3: Get the new code

**From Git:**

```bash
git pull origin main
```

**From another machine (rsync):**

On your development machine:

```bash
rsync -avz --exclude node_modules --exclude atlas.db ./automation-testing/ pi@<pi-ip>:~/automation-testing/
```

**From USB or other transfer:**

Copy the new project files over the existing folder, but **do not overwrite** `atlas.db` or `node_modules`.

### Step 4: Install dependencies

**If building on the Pi:**

```bash
cd ~/automation-testing
npm install
```

**If you built on your dev machine and copied `dist`:**

```bash
cd ~/automation-testing
npm install --omit=dev
```

### Step 5: Build (if building on the Pi)

```bash
npm run build
```

Skip this step if you copied a pre-built `dist` folder.

### Step 6: Start the app

```bash
pm2 start automation-testing
# or, if it was deleted from PM2:
pm2 start ecosystem.config.cjs
```

### Step 7: Verify

```bash
pm2 status
pm2 logs automation-testing
```

Open the app in a browser and confirm it works.

---

## Quick Upgrade (single command)

If you use Git and build on the Pi, you can run the control script:

```bash
cd ~/automation-testing
./scripts/ctl.sh update
```

Or the same steps manually:

```bash
cd ~/automation-testing
cp atlas.db atlas.db.backup.$(date +%Y%m%d-%H%M%S)
pm2 stop automation-testing
git pull origin main
npm install
npm run build
pm2 start automation-testing
```

If you installed a [system-wide command](SYSTEM_COMMANDS.md), you can run `atlas-ctl update` from anywhere.

---

## Rollback (if something goes wrong)

If the upgrade fails:

```bash
# 1. Restore the database backup
cd ~/automation-testing
cp atlas.db.backup.YYYYMMDD-HHMMSS atlas.db

# 2. Revert code (if using Git)
git checkout <previous-commit-or-tag>

# 3. Rebuild and restart
npm install
npm run build
pm2 restart automation-testing
```

---

## Database Location

The database file `atlas.db` is stored in the **project root** (e.g. `~/automation-testing/atlas.db`), not inside `dist/`. This ensures it survives `npm run build`, which recreates the `dist/` folder.

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
