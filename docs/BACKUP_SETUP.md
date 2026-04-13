# DC Automation — backup setup (database + on-disk files)

Production backups combine **database** dumps and **on-disk** data (independent concerns):

1. **Database** — either the **SQLite** file (`dc-automation.db` / `DB_PATH`) or a **PostgreSQL** logical dump (`pg_dump`), depending on whether the app uses **`DATABASE_URL`**.
2. **On-disk user data** — wiki trees, uploaded files, and optional small config files that **never** appear inside the database dump alone.

The in-app scheduler can run **two database jobs** (frequent **`db-snapshots/`** and optional separate full archives under **`db-full-snapshots/`**) plus a **files mirror** — see below.

### In-app backup (UI)

The app can run the same style of backups from **`/admin/backup`** (permission **`backup.manage`** — separate from **App settings** / `settings.access`). You configure:

- A single **rclone remote path** (e.g. `dropbox:Backups/dc-automation`) — tokens live in **`rclone config`** on the host, not in the app. For **Dropbox**, which options to pick in `rclone config` (storage type, blank app key/secret, OAuth) is spelled out in **[rclone remote (Dropbox or other)](#rclone-remote-dropbox-or-other)** below.
- **Schedules**: **database snapshots** under `db-snapshots/<stamp>/`, optional **full database archive** under `db-full-snapshots/<stamp>/` (same dump format, separate schedule and retention), and the **incremental file mirror** under `mirror/…` (rclone sync/copy; only changed files transfer). When **Files** uploads are included, the app also writes **`mirror/uploads/files-original/`** — the same file bytes as `uploads/files/` but laid out with **library folder names and original filenames** from the database (for readable archives); the **`mirror/uploads/files/`** tree still mirrors on-disk UUID names for full restore.
- **Scope** (database, optional full database archive, wiki, **uploads** split into `uploads/files/`, `uploads/testing/`, and `uploads/home/` — older saved settings that only had a single “uploads” toggle apply to all three), optional small files), **retention** for each DB tree (`keepLastBackups` / `maxAgeDays` vs `keepLastFullDatabaseBackups` / `maxAgeDaysFullDatabase`), **mirror mode** (sync vs additive copy), optional **Discord** / **mail** notifications, and **download** of the latest local snapshot zips (streamed; **`rcloneBwlimit`** applies to rclone jobs).
- **Dropbox database upload:** Each job copies a snapshot folder to `…/<db-snapshots|db-full-snapshots>/<stamp>.uploading` on the remote, then **moves** it to `…/<stamp>/` so the final path does not appear until the upload is complete. If the move fails, it attempts to purge the `.uploading` path.
- **Roles:** Grant **Configure backups** (`backup.manage`) under **Admin → Roles** for operators who should use this page. It is **not** implied by **App settings** (`settings.access`). The seeded **admin** role uses `*` (all permissions); other roles need `backup.manage` explicitly if they should configure backups without full access.

There is **no in-app encryption at rest**; use an **rclone crypt** remote or host/ Dropbox controls if you need encryption.

**Restore drill:** After a backup, confirm you can list the remote folder with `rclone lsd` / `rclone ls`, download the latest **`db-snapshots`** folder (or use **Download latest DB snapshot** in the UI), restore the database with `pg_restore` or by replacing the SQLite file while the app is stopped, and confirm wiki/uploads match a backup from **around the same time** as the database (restoring an old DB with a newer file tree, or the reverse, can be inconsistent).

**PostgreSQL snapshot folder contents (in-app and same layout for scripted dumps if you match it):** `database.dump` (custom `pg_dump`, includes `--create` for `pg_restore --create`), optional `globals.sql` when `pg_dumpall --globals-only` succeeds (roles; may fail on hosted DBs without superuser — see `RESTORE_README.txt` in the folder), plus `RESTORE_README.txt` and `manifest.json`. **SQLite:** `dc-automation-backup.db` plus `RESTORE_README.txt`. A logical dump does not include other databases on the same cluster or provider-only cluster settings.

**Single instance:** Scheduled backups use in-process timers; run **one** Node process for the app or use external scheduling only.

---

Schedule **when** each job runs with **cron** on the same machine as the app (Linux / **Raspberry Pi**) if you prefer scripts instead of the in-app scheduler. The examples below are copy-paste starting points; change minutes, hours, and paths to match your policy.

---

## Which backend are you using?

| App configuration | Database backup |
| --- | --- |
| SQLite only (no Postgres `DATABASE_URL`, or file-based dev) | [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh) + [`backup.conf`](../scripts/backup.conf.example) |
| **`DATABASE_URL`** points at PostgreSQL | **`pg_dump`** → upload with **rclone** (see [PostgreSQL scheduled logical backups](#postgresql-scheduled-logical-backups)) |

Always run **`backup-on-disk-files.sh`** (or an equivalent) for wiki + uploads — relational data in Postgres/SQLite does **not** replace `content/wiki/` or `uploads/`.

---

## What is included in a “full site” recovery

**Database**

- **SQLite:** one file (often `dc-automation.db` in `APP_ROOT`, or whatever **`DB_PATH`** names).
- **PostgreSQL:** restore from **`pg_dump`** output (recommended), not by copying raw PostgreSQL data-directory files unless you are doing advanced DBA-level physical backups (out of scope here).

**On-disk (use [`scripts/backup-on-disk-files.sh`](../scripts/backup-on-disk-files.sh) or the manual commands in [Manual one-off tarball](#manual-one-off-tarball))**

| Path | What it is |
| --- | --- |
| **`content/wiki/`** | Wiki **`*.md`**, **`.wiki-page-meta.json`**, **`.wiki-order.json`**, recycle under **`_deleted/`**, manifests, etc. |
| **`content/wiki-seed/`** | Shipped defaults (often in git); back up if **customized**. |
| **`content/home-intro.md`** | Optional home intro override. |
| **`uploads/`** | **`/api/uploads/…`**: **`uploads/files/`**, **`uploads/testing/`**, **`uploads/home/`**, etc. |
| **`config.json`** | Optional local config; **sensitive** if it holds credentials. |
| **`scripts/backup.conf`** | Your SQLite backup settings — convenient to restore the same job; not required for the app runtime. |

**Neither** `sqlite-dropbox-backup.sh` **nor** `pg_dump` backs up the paths in this table — only the DB layer.

**Usually regenerable (optional to skip in archives):** **`dist/`**, **`node_modules/`**, **`build-version.json`**.

**Secrets not to put in plain cloud folders**

| Item | Notes |
| --- | --- |
| **`.env`** | **`DATABASE_URL`**, **`JWT_SECRET`**, etc. Use a password manager, **rclone crypt**, or host disk encryption. |
| **`config.json`** | Same if it contains secrets. |

---

## Prerequisites (Debian / Ubuntu / Raspberry Pi OS)

```bash
sudo apt-get update
sudo apt-get install -y rsync rclone curl
```

- **SQLite backups:** `sudo apt-get install -y sqlite3`
- **PostgreSQL logical backups:** `sudo apt-get install -y postgresql-client` (provides **`pg_dump`** / **`pg_restore`**)
- Optional **email** alerts (SQLite script): `sudo apt-get install -y mailutils` and a working MTA (e.g. msmtp).

---

## rclone remote (Dropbox or other)

Backups need an **rclone remote** on the **same host** that runs the app or your cron scripts. Credentials live in **`rclone config`** (typically **`~/.config/rclone/rclone.conf`**), not in the DC Automation UI.

### Dropbox: `rclone config` — what to select

Use these choices for a typical **personal** Dropbox account with rclone’s default OAuth app. Official reference: [rclone Dropbox backend](https://rclone.org/dropbox/).

| Step | Prompt | What to enter |
| --- | --- | --- |
| 1 | Main menu | **`n`** (New remote). |
| 2 | `name>` | A short name used in all paths, e.g. **`dropbox`**. Use this exact name in **Admin → Backup** and in **`backup.conf`**. |
| 3 | `Storage>` | Type **`dropbox`** or pick **Dropbox** from the list. |
| 4 | App key / secret (`app_key` / `app_secret`) | **Leave blank** (press Enter). Rclone uses its shared Dropbox app; that is enough for normal backups. |
| 5 | OAuth / “Use auto config?” | **Yes** if this machine can open a browser (rclone listens on **`http://127.0.0.1:53682/`** during login — temporarily allow it in a local firewall). **No** on a headless server; then use [rclone remote setup](https://rclone.org/remote_setup/) to complete authorization on another device and paste the token. |
| 6 | Advanced config | **No** unless you know you need extra options (team accounts, custom chunk size, etc.). |
| 7 | Save | **`y`** to keep the remote. |

Check that it works:

```bash
rclone lsd dropbox:
```

**Dropbox Business / team space:** `dropbox:path` is usually your **personal** folder. To see **team** roots, list with a leading slash: `rclone lsd dropbox:/`, then use paths like `dropbox:/TeamFolder/Backups/...`. See [Dropbox for business](https://rclone.org/dropbox/#dropbox-for-business).

**Your own Dropbox app:** If you outgrow the shared app or need **Dropbox Team** features (e.g. impersonation), create an app in the [Dropbox App Console](https://www.dropbox.com/developers/apps), set the redirect URI to **`http://localhost:53682/`**, then enter **App key** / **App secret** at the `app_key` / `app_secret` prompts. Details: [Get your own Dropbox App ID](https://rclone.org/dropbox/#get-your-own-dropbox-app-id).

### Remote path examples for DC Automation

Use **no trailing slash** in paths.

| Where | Example remote path | What goes there |
| --- | --- | --- |
| **Admin → Backup** (in-app jobs) | **`dropbox:Backups/dc-automation`** | One prefix; the app writes **`db-snapshots/`** (frequent snapshots), optional **`db-full-snapshots/`** (second full logical dump with its own schedule/retention), and **`mirror/`** (files) under it. |
| **`backup.conf`** / SQLite script | **`dropbox:Backups/dc-automation/sqlite`** | Timestamped folders under **`…/snapshots/`**. |
| **PostgreSQL** `pg_dump` example | **`dropbox:Backups/dc-automation/postgres`** | Dedicated DB dump prefix. |
| **`backup-on-disk-files.sh`** | **`dropbox:Backups/dc-automation/on-disk`** | Optional **`RCLONE_REMOTE_BASE`**. |

You may create **`Backups/dc-automation`** in the Dropbox web UI first; otherwise rclone creates folders on first upload.

### Other backends and encryption

For **S3, Google Drive**, etc., choose that storage type in `rclone config` and still pass **`remote:path`** in the same style.

For **encryption at rest** on the remote, add an **rclone crypt** remote that wraps your Dropbox (or other) remote, then use the **crypt** remote name in the path ([rclone crypt](https://rclone.org/crypt/)). Point **`RCLONE_REMOTE`** / **`RCLONE_REMOTE_BASE`** at that crypt remote in scripts.

---

## Configurable schedule — cron

Edit the crontab for the user that can read the database and write archives (often the same user that runs PM2):

```bash
crontab -e
```

**Fields:** `minute hour day-of-month month day-of-week command`

| Expression | Meaning |
| --- | --- |
| `0 * * * *` | Every hour at :00 |
| `15 * * * *` | Every hour at :15 |
| `30 2 * * *` | Daily at 02:30 |
| `0 3 * * 0` | Weekly, Sundays at 03:00 |

**Stagger** jobs so the DB dump and the large file tree do not always start together (e.g. DB at minute **10**, on-disk backup at minute **25**).

**Logs:** append output, e.g. `>> /var/log/dc-automation-backup.log 2>&1` (ensure the file is writable, or use `logger`).

**systemd timers:** Equivalent to cron — invoke the same scripts on a calendar you define in a `.timer` unit.

---

<a id="postgresql-scheduled-logical-backups"></a>

## PostgreSQL — scheduled logical backups

If **`DATABASE_URL`** is set, use **`pg_dump`** (not the SQLite script). Upload dumps with **rclone** the same way you upload SQLite snapshots, under a **dedicated** remote prefix (e.g. `dropbox:Backups/dc-automation/postgres`).

### One-off commands (manual test)

```bash
# Custom format (compressed; restore with pg_restore)
pg_dump --format=custom --file=/path/to/staging/dc-automation-$(date +%Y%m%d-%H%M).dump "$DATABASE_URL"

# Plain SQL (readable; larger; restore with psql -f)
pg_dump --file=/path/to/staging/dc-automation-$(date +%Y%m%d-%H%M).sql "$DATABASE_URL"
```

### Connection and credentials

Use the **same** `DATABASE_URL` the app uses (see **`.env`** next to **`APP_ROOT`**). The user running cron must be allowed to connect as the DB role used in that URL.

**`~/.pgpass`** (mode **600**) avoids putting passwords in the crontab:

```text
127.0.0.1:5432:dc-automation:dcauto:your-password-here
```

See **`man pgpass`** for the exact line format if you use non-default host/port/database/user names.

### Example script: `pg_dump` + rclone + local staging cleanup

Save as e.g. **`scripts/pg-dropbox-backup.sh`**, **`chmod +x`**, and point cron at it. Adjust **`APP_ROOT`**, **`STAGING_ROOT`**, **`RCLONE_REMOTE`**, and **`KEEP_LOCAL`** to your layout.

```bash
#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="/home/dcauto/dc-automation"
# Load DATABASE_URL from .env (same as the app)
# shellcheck source=/dev/null
[ -f "$APP_ROOT/.env" ] && set -a && . "$APP_ROOT/.env" && set +a
: "${DATABASE_URL:?Set DATABASE_URL in .env or export before run}"

STAGING_ROOT="/var/lib/dc-automation-pg-backup"
RCLONE_REMOTE="dropbox:Backups/dc-automation/postgres"
KEEP_LOCAL="${KEEP_LOCAL:-14}"   # keep this many recent dump files under STAGING_ROOT (0 = skip prune)

umask 077
mkdir -p "$STAGING_ROOT/snapshots"
STAMP="$(date +%Y%m%d-%H%M)"
DUMP_NAME="dc-automation-$STAMP.dump"
DUMP_PATH="$STAGING_ROOT/snapshots/$DUMP_NAME"
REMOTE_DST="${RCLONE_REMOTE%/}/snapshots/$STAMP/"

pg_dump --format=custom --file="$DUMP_PATH" "$DATABASE_URL"
rclone copy "$DUMP_PATH" "$REMOTE_DST" --retries 5 --low-level-retries 10 --timeout 2m

if [ "${KEEP_LOCAL}" -gt 0 ] 2>/dev/null; then
  cd "$STAGING_ROOT/snapshots" && ls -1t dc-automation-*.dump 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f
fi
```

**Cron (hourly example):**

```cron
10 * * * * /home/dcauto/dc-automation/scripts/pg-dropbox-backup.sh >> /var/log/dc-automation-pg-backup.log 2>&1
```

**Remote retention:** The SQLite helper script prunes old **remote** snapshots automatically (`KEEP_LAST`, `MAX_AGE_DAYS`). For **`pg_dump`**, either:

- Periodically delete older **`…/postgres/snapshots/<timestamp>/`** folders on the remote with **`rclone delete`** / **`rclone purge`** (list with **`rclone lsf`**), or
- Rely on your cloud provider’s lifecycle rules, or
- Accept accumulation and clean up manually.

The **`KEEP_LOCAL`** loop above only limits **disk use on the server**, not history in Dropbox.

### Restore (PostgreSQL)

```bash
# Typical restore into an empty database owned by the app user (adjust flags for your environment):
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /path/to/dc-automation-TIMESTAMP.dump

# Plain SQL file:
psql "$DATABASE_URL" -f /path/to/dc-automation.sql
```

Stop the app or ensure no concurrent writers while replacing production data.

---

## SQLite — scheduled backups

Use [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh): online **`sqlite3 .backup`**, skip-if-unchanged, local staging, **`rclone copy`**, remote retention (**`KEEP_LAST`**, **`MAX_AGE_DAYS`**), optional Discord/mail.

1. Copy [`scripts/backup.conf.example`](../scripts/backup.conf.example) → **`scripts/backup.conf`**.
2. Set **`DB_PATH`**, **`STAGING_ROOT`**, **`RCLONE_REMOTE`** (full variable list: [Create `backup.conf`](#3-create-backupconf) below).
3. Test manually, then add cron, e.g. hourly:

```cron
5 * * * * /home/dcauto/dc-automation/scripts/sqlite-dropbox-backup.sh >> /var/log/dc-automation-sqlite-backup.log 2>&1
```

Use **either** the SQLite script **or** the PostgreSQL flow — not both — for one deployment.

---

## On-disk user files — `backup-on-disk-files.sh`

[`scripts/backup-on-disk-files.sh`](../scripts/backup-on-disk-files.sh) packs **`content/wiki`**, **`uploads`**, and optional paths into **`dc-automation-files-<timestamp>.tar.gz`**, and optionally **`rclone copy`** to **`RCLONE_REMOTE_BASE/<timestamp>/…`** and/or **`rsync`** to **`RSYNC_MIRROR`**. It does **not** back up the database.

1. Copy [`scripts/files-backup.conf.example`](../scripts/files-backup.conf.example) → **`scripts/files-backup.conf`**.
2. Set at least **`APP_ROOT`** and **`ARCHIVE_DIR`** (absolute paths).

| Variable | Purpose |
| --- | --- |
| **`APP_ROOT`** | DC Automation checkout (same working directory PM2 uses). Default: parent of **`scripts/`**. |
| **`ARCHIVE_DIR`** | Where **`dc-automation-files-<stamp>.tar.gz`**, logs, and lock files live. |
| **`ENABLE_TAR`** | **`1`** (default) builds the tarball; **`0`** skips it (only rclone/rsync if those are set). |
| **`RCLONE_REMOTE_BASE`** | Optional — each run uploads under **`<remote>/<timestamp>/…`**. |
| **`RSYNC_MIRROR`** | Optional local/NAS path — **`rsync -a --delete`** for **`content/wiki`** and **`uploads`**. |
| **`RCLONE_OPTS`** | Passed through to rclone. |
| **`LOG_FILE`**, **`LOCK_FILE`** | Override defaults under **`ARCHIVE_DIR`**. |

If the config is not beside the script, set **`FILES_BACKUP_CONF=/path/to/files-backup.conf`**.

```bash
chmod +x scripts/backup-on-disk-files.sh
./scripts/backup-on-disk-files.sh
```

**Cron (typical: daily; stagger from the DB job):**

```cron
25 2 * * * /home/dcauto/dc-automation/scripts/backup-on-disk-files.sh >> /var/log/dc-automation-files-backup.log 2>&1
```

---

## Example crontab — database + on-disk on one host

**PostgreSQL** (adjust paths and users):

```cron
# PostgreSQL logical dump (hourly)
10 * * * * /home/dcauto/dc-automation/scripts/pg-dropbox-backup.sh >> /var/log/dc-automation-pg-backup.log 2>&1

# Wiki + uploads tarball / rclone (daily)
25 2 * * * /home/dcauto/dc-automation/scripts/backup-on-disk-files.sh >> /var/log/dc-automation-files-backup.log 2>&1
```

**SQLite** — replace the first line with:

```cron
5 * * * * /home/dcauto/dc-automation/scripts/sqlite-dropbox-backup.sh >> /var/log/dc-automation-sqlite-backup.log 2>&1
```

If **`BACKUP_CONF`** or **`FILES_BACKUP_CONF`** live outside **`scripts/`**, prefix the line, e.g. **`BACKUP_CONF=/etc/dc-automation/backup.conf`** before the script path.

---

## Restore checklist

1. **Database:** **`pg_restore`** / **`psql`**, or copy the SQLite file to **`DB_PATH`** while the app is stopped.
2. **On-disk data:** extract **`dc-automation-files-*.tar.gz`** at **`APP_ROOT`**, or **`rclone copy`** / **`rsync`** back into **`content/wiki/`**, **`uploads/`**, etc.
3. **Secrets:** restore **`.env`** / **`config.json`** from secure storage (not necessarily the same archive as wiki/uploads).
4. **`npm install && npm run build`**, restart **PM2** (or systemd).

---

## Manual one-off tarball

On the app host, without the bundled script — writes a single archive you can copy to USB or upload manually:

```bash
APP_ROOT="$HOME/dc-automation"
ARCHIVE_DIR="/var/lib/dc-automation-file-backups"
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$ARCHIVE_DIR"
cd "$APP_ROOT" || exit 1

parts=(content/wiki uploads)
[ -d content/wiki-seed ] && parts+=(content/wiki-seed)
[ -f content/home-intro.md ] && parts+=(content/home-intro.md)
[ -f config.json ] && parts+=(config.json)
[ -f scripts/backup.conf ] && parts+=(scripts/backup.conf)

tar -czf "$ARCHIVE_DIR/dc-automation-files-$STAMP.tar.gz" "${parts[@]}"
echo "Created $ARCHIVE_DIR/dc-automation-files-$STAMP.tar.gz"
```

Do **not** add **`.env`** to an unencrypted shared folder.

---

## Optional: rclone / rsync mirrors for on-disk data only

**Dated rclone copy** (same remote style as the scripts):

```bash
APP_ROOT="$HOME/dc-automation"
REMOTE_BASE="dropbox:Backups/dc-automation/on-disk"
STAMP=$(date +%Y%m%d-%H%M)
DEST="$REMOTE_BASE/$STAMP"

rclone copy "$APP_ROOT/content/wiki" "$DEST/content/wiki" --retries 5
rclone copy "$APP_ROOT/uploads" "$DEST/uploads" --retries 5
[ -d "$APP_ROOT/content/wiki-seed" ] && rclone copy "$APP_ROOT/content/wiki-seed" "$DEST/content/wiki-seed" --retries 5
[ -f "$APP_ROOT/content/home-intro.md" ] && rclone copy "$APP_ROOT/content/home-intro.md" "$DEST/content/" --retries 5
```

Prefer **`rclone copy`** (additive). **`rclone sync`** toward the remote can **delete** remote files — only use it if you intend a true mirror.

**Local NAS mirror:**

```bash
APP_ROOT="$HOME/dc-automation"
NAS="/mnt/backup/dc-automation"

rsync -a --delete "$APP_ROOT/content/wiki/" "$NAS/content/wiki/"
rsync -a --delete "$APP_ROOT/uploads/" "$NAS/uploads/"
```

Drop **`--delete`** if you want a cumulative destination that never removes old files.

---

<a id="sqlite-detailed-reference-sqlite-dropbox-backupsh"></a>

## SQLite: detailed reference (`sqlite-dropbox-backup.sh`)

The sections below document the Bash script [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh) for backing up the app’s SQLite database (`dc-automation.db` by default) to **Dropbox** (or any rclone remote), with safe online backups (`sqlite3 .backup`), change detection, retention, and optional alerts.

**Target environment:** Linux (including **Raspberry Pi**). The script is not intended to run under Windows; use the same machine where the app runs in production, or a host that can read the database file over a reliable path.

---

## What the script does

1. **Single-instance lock** (`flock`) so overlapping cron runs do not corrupt work.
2. **Skip if unchanged:** compares `PRAGMA data_version` (or SHA-256 fallback) to a small local state file—**not** a second copy of the database.
3. **Consistent copy:** runs SQLite’s **online backup API** via the `sqlite3` CLI (not `cp`).
4. **Timestamped snapshot** under a local staging directory, with **rsync `--link-dest`** when a previous snapshot exists.
5. **Upload** with `rclone copy` to `remote:…/snapshots/<timestamp>/`.
6. **Local cleanup:** removes older snapshot dirs on disk so long-term history lives on Dropbox (staging stays small).
7. **Remote retention:** keeps the newest `KEEP_LAST` snapshots; optional age-based prune with `MAX_AGE_DAYS`.
8. **Logging** to files; on failure, optional **Discord** and/or **mail**.

---

## 1. Install system packages

On Debian / Ubuntu / Raspberry Pi OS:

```bash
sudo apt-get update
sudo apt-get install -y sqlite3 rsync rclone curl
```

Optional for **email** alerts:

```bash
sudo apt-get install -y mailutils
```

Configure an MTA (e.g. `msmtp`, Postfix, or your provider’s relay) so `mail` can send—details depend on your host.

**Discord** notifications use `curl` and prefer `python3` for JSON encoding (usually already installed on Pi/desktop).

---

## 2. Install and configure rclone (Dropbox)

1. If rclone is new on this machine, run **`rclone config`** and add a Dropbox remote using the table in **[rclone remote (Dropbox or other)](#rclone-remote-dropbox-or-other)** (storage **`dropbox`**, blank app key/secret unless you use your own app, then OAuth).

2. Confirm access:

   ```bash
   rclone lsd dropbox:
   ```

3. Pick a **dedicated folder** for this script (it uploads under `…/snapshots/` inside that path). Example remote prefix:

   ```text
   dropbox:Backups/dc-automation/sqlite
   ```

   Use **no trailing slash** in config.

---

## 3. Create `backup.conf`

1. Copy the example next to the script (or anywhere you prefer):

   ```bash
   cd /path/to/dc-automation/scripts
   cp backup.conf.example backup.conf
   nano backup.conf   # or your editor
   ```

2. Set at least:

   | Variable | Meaning |
   |----------|--------|
   | `DB_PATH` | Absolute path to the **live** `dc-automation.db` (same file the Node app uses; match `DB_PATH` env if you set it in PM2/systemd). |
   | `STAGING_ROOT` | Local directory for staging, logs, state, and lock (e.g. `/var/lib/dc-automation-backup`). Must be writable by the user that runs the script. |
   | `RCLONE_REMOTE` | e.g. `dropbox:Backups/dc-automation/sqlite` |

3. Adjust retention:

   - `KEEP_LAST` — number of **remote** timestamped snapshots to keep (e.g. `24` for hourly ≈ one day).
   - `MAX_AGE_DAYS` — optional; `0` disables. If both are set, old snapshots may be removed by **either** rule.

4. Optional alerts:

   - `DISCORD_WEBHOOK` — channel webhook URL (empty = disabled).
   - `MAIL_TO` — address for `mail` (empty = disabled).

5. Optional tuning: `RCLONE_OPTS` (retries, timeout, `--bwlimit`, etc.). See [Optional enhancements](#optional-enhancements).

The script loads, in order:

- `$BACKUP_CONF` if set and the file exists, else
- `backup.conf` in the same directory as `sqlite-dropbox-backup.sh`.

---

## 4. Permissions and user

- The user running the backup must be able to **read** `DB_PATH` and **write** under `STAGING_ROOT`.
- If the app runs as `www-data` or another user, either run the backup as that user or adjust group ACLs so the backup user can read the database file.

Example (adjust users/paths):

```bash
sudo mkdir -p /var/lib/dc-automation-backup
sudo chown -R deploy:deploy /var/lib/dc-automation-backup
chmod +x /path/to/dc-automation/scripts/sqlite-dropbox-backup.sh
```

---

## 5. Test run

Run once manually (as the same user cron will use):

```bash
export BACKUP_CONF=/path/to/scripts/backup.conf   # if not beside the script
/path/to/dc-automation/scripts/sqlite-dropbox-backup.sh
```

Check:

- Exit code `0`.
- Log file (default under `$STAGING_ROOT/logs/backup.log`).
- Dropbox path: `rclone lsd "${RCLONE_REMOTE}/snapshots/"` (after first successful run).

If the database **has not changed** since the last successful backup, the script logs a skip and exits `0`.

---

## 6. Cron (hourly)

Edit the crontab for the backup user:

```bash
crontab -e
```

Example: run every hour on the hour, with an **extra** flock on a system path (optional double lock):

```cron
0 * * * * /usr/bin/flock -n /var/run/dc-automation-backup.lock -c '/path/to/dc-automation/scripts/sqlite-dropbox-backup.sh'
```

If `BACKUP_CONF` is not beside the script, set it inside the cron line:

```cron
0 * * * * BACKUP_CONF=/path/to/backup.conf /path/to/sqlite-dropbox-backup.sh
```

The script already uses `flock` on `LOCK_FILE`; the outer `flock` is optional.

---

## 7. State file (local metadata only)

`STATE_FILE` stores the last `data_version` (or hash) and timestamp **after** a successful backup and upload. It is **not** a backup of the database; full backups live under Dropbox `snapshots/`.

---

## Optional enhancements

### Encryption (rclone crypt)

Create a **crypt** remote that wraps Dropbox (or a subfolder), then set `RCLONE_REMOTE` to that remote. See `rclone help crypt` and the [rclone crypt documentation](https://rclone.org/crypt/).

### Bandwidth limits

Append to `RCLONE_OPTS`, e.g.:

```bash
RCLONE_OPTS="--retries 5 --low-level-retries 10 --timeout 2m --bwlimit 1M"
```

### Integrity check

`RUN_INTEGRITY_CHECK=1` (default) runs `PRAGMA integrity_check` on the copied file before upload. Set to `0` to disable (not recommended).

### Restic / Borg

For heavy deduplication across many machines, consider **restic** or **borg** targeting an rclone remote; that is outside this script but compatible with the same Dropbox backend.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| `missing required command` | Install `sqlite3`, `rsync`, `rclone`, `flock` (`util-linux`). For PostgreSQL dumps: `postgresql-client` (`pg_dump`). |
| `database file not found` | `DB_PATH` wrong or app not deployed yet. |
| `pg_dump` fails / authentication | `DATABASE_URL` correct; cron user can read **`.env`**; **`~/.pgpass`** mode **600** and host/port/db/user match **`pg_hba.conf`**; DB user has **`CONNECT`** on the database. |
| `pg_dump: error: aborting because of server version mismatch` | **`pg_dump`** client major version should match or exceed the server (install a newer **`postgresql-client`** from PG APT or use the same major as `sudo -u postgres psql -c "SHOW server_version;"`). |
| rclone auth errors | Re-run `rclone config`, token expiry, remote name matches `RCLONE_REMOTE` / `RCLONE_REMOTE_BASE`. |
| Discord not firing | `curl` installed; webhook URL correct; `python3` for JSON (optional fallback exists). |
| Mail not sending | `mailutils` + working MTA; test with `echo test \| mail -s test you@example.com`. |
| Backups every hour despite no edits | State file not updating—check write permissions on `STATE_FILE` directory; inspect logs for failed steps before state write. |
| On-disk script exits 1 | `APP_ROOT` wrong; or neither `content/wiki` nor `uploads` exists; or `RCLONE_REMOTE_BASE` / `RSYNC_MIRROR` set but `rclone` / `rsync` not installed. |

---

## Related files

- [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh) — SQLite online backup + rclone; see [SQLite detailed reference](#sqlite-detailed-reference-sqlite-dropbox-backupsh).
- [`scripts/backup.conf.example`](../scripts/backup.conf.example) — template for `backup.conf`.
- **PostgreSQL** — example **`pg_dump` + rclone** script is embedded in [PostgreSQL — scheduled logical backups](#postgresql-scheduled-logical-backups); save it as e.g. `scripts/pg-dropbox-backup.sh` on the server.
- [`scripts/backup-on-disk-files.sh`](../scripts/backup-on-disk-files.sh) — wiki / uploads / optional config tarball + optional rclone and rsync.
- [`scripts/files-backup.conf.example`](../scripts/files-backup.conf.example) — template for `files-backup.conf`.
