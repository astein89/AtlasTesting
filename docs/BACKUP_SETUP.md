# SQLite → Dropbox backup setup

## PostgreSQL deployments

If the app uses **PostgreSQL** (`DATABASE_URL` is set), back up the database with **`pg_dump`** (or your host’s managed backups), not the SQLite script below. Typical pattern:

```bash
# Custom-format dump (compressed, single DB)
pg_dump --format=custom --file=/path/to/staging/dc-automation-$(date +%Y%m%d-%H%M).dump "$DATABASE_URL"

# Plain SQL (readable; larger)
pg_dump --file=/path/to/staging/dc-automation-$(date +%Y%m%d-%H%M).sql "$DATABASE_URL"
```

Upload the resulting file with **rclone** the same way you would upload SQLite snapshots (point `RCLONE_REMOTE` at a folder such as `dropbox:Backups/dc-automation/postgres`). Document **restore** in your runbook: `pg_restore -d "$DATABASE_URL" file.dump` (custom format) or `psql "$DATABASE_URL" -f file.sql` (plain). Rotate old dumps with retention rules similar to `KEEP_LAST` / `MAX_AGE_DAYS` in [`backup.conf.example`](../scripts/backup.conf.example).

### On-disk data outside the database

**Neither** `pg_dump` **nor** `sqlite-dropbox-backup.sh` backs up anything except the **database file** (SQLite) or **logical DB dump** (PostgreSQL). Everything below lives **outside** the DB and must be copied separately if you need a full restore.

| Path | What it is |
| --- | --- |
| **`content/wiki/`** | All wiki content: **`*.md`** pages, **`.wiki-page-meta.json`**, **`.wiki-order.json`**, **`.wiki-seed-applied.json`**, recycle (**`_deleted/`** and **`.wiki-recycle-manifest.json`** inside it). |
| **`content/wiki-seed/`** | Default seed Markdown shipped with the app (usually tracked in **git**). Back up only if you **customize** files here; otherwise a fresh clone restores them. |
| **`content/home-intro.md`** | Optional file override for the home intro (if present); otherwise the app uses a built-in default. |
| **`uploads/`** | Entire tree served as **`/api/uploads/…`**: **`uploads/files/`** (Files module binaries), **`uploads/testing/`** (Testing field images), **`uploads/home/`** (welcome logo / site favicon). Legacy installs may still have loose files in **`uploads/`** root. |
| **`config.json`** | Optional local config (e.g. **`databaseUrl`** when not using env). **Treat as sensitive** if it contains credentials. |
| **`.env`** | Often holds **`DATABASE_URL`**, **`JWT_SECRET`**, etc. **Not** included in DB backups; store in a **secret manager** or encrypted backup—do not upload secrets to shared Dropbox without **rclone crypt** or equivalent. |
| **`scripts/backup.conf`** | Your **`sqlite-dropbox-backup.sh`** settings (`DB_PATH`, `RCLONE_REMOTE`, …). Convenience to restore the same backup job; not required for app data. |

**Usually regenerable (optional to exclude from “full site” backups):** **`dist/`**, **`node_modules/`**, **`build-version.json`** (rewritten on **`npm run build`**).

#### How to back up on-disk data (Linux / Raspberry Pi)

Run these **on the machine where the app lives** (same host as **`sqlite-dropbox-backup.sh`** / **`pg_dump`**). Replace **`APP_ROOT`** with your checkout (e.g. **`~/dc-automation`**).

**Bundled script (recommended):** [`scripts/backup-on-disk-files.sh`](../scripts/backup-on-disk-files.sh) — copies the same paths into a timestamped **`dc-automation-files-<stamp>.tar.gz`** under **`ARCHIVE_DIR`**, and optionally uploads to **`RCLONE_REMOTE_BASE/<stamp>/…`** and/or mirrors with **`RSYNC_MIRROR`**. Copy [`scripts/files-backup.conf.example`](../scripts/files-backup.conf.example) to **`scripts/files-backup.conf`**, set **`APP_ROOT`** / **`ARCHIVE_DIR`** (and rclone/rsync if wanted), then:

```bash
chmod +x scripts/backup-on-disk-files.sh
./scripts/backup-on-disk-files.sh
```

**1. One archive (tar.gz) — manual equivalent**

Writes a single file you can copy to USB, another server, or upload with **rclone** manually:

```bash
APP_ROOT="$HOME/dc-automation"
ARCHIVE_DIR="/var/lib/dc-automation-file-backups"   # or ~/backups
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

**`.env`:** do **not** put it in an unencrypted cloud folder. Copy it only to encrypted storage, a password manager export, or use **`rclone crypt`** / host-level disk encryption.

**2. rclone to Dropbox (or another remote) — mirror trees**

Uses the same **rclone** remote you configured for SQLite backups. Prefer a **dated folder** per run so mistakes do not overwrite good data:

```bash
APP_ROOT="$HOME/dc-automation"
REMOTE_BASE="dropbox:Backups/dc-automation/on-disk"   # no trailing slash
STAMP=$(date +%Y%m%d-%H%M)
DEST="$REMOTE_BASE/$STAMP"

rclone copy "$APP_ROOT/content/wiki" "$DEST/content/wiki" --retries 5
rclone copy "$APP_ROOT/uploads" "$DEST/uploads" --retries 5
[ -d "$APP_ROOT/content/wiki-seed" ] && rclone copy "$APP_ROOT/content/wiki-seed" "$DEST/content/wiki-seed" --retries 5
[ -f "$APP_ROOT/content/home-intro.md" ] && rclone copy "$APP_ROOT/content/home-intro.md" "$DEST/content/" --retries 5
```

Use **`rclone copy`** (additive). Avoid **`rclone sync`** toward Dropbox unless you understand that it can **delete** remote files to match the source.

**3. rsync to a second disk or NAS**

Good for a local mirror (fast restore):

```bash
APP_ROOT="$HOME/dc-automation"
NAS="/mnt/backup/dc-automation"    # adjust

rsync -a --delete "$APP_ROOT/content/wiki/" "$NAS/content/wiki/"
rsync -a --delete "$APP_ROOT/uploads/" "$NAS/uploads/"
```

`--delete` keeps the mirror exact; drop it if you want a cumulative “never delete on dest” copy.

**4. Cron (example: daily files + your existing DB job)**

Example: files at **02:15** using the repo script:

```cron
15 2 * * * /home/dcauto/dc-automation/scripts/backup-on-disk-files.sh >> /var/log/dc-automation-files-backup.log 2>&1
```

Point **`ARCHIVE_DIR`** at a path the cron user can write. Combine with the hourly SQLite script ([§6 Cron](#6-cron-hourly)) or **`pg_dump`** on a similar schedule.

**5. Restore (short)**

1. Restore the **database** (`pg_restore` / `psql`, or copy **`dc-automation.db`**).
2. Extract or **rsync** back **`content/wiki/`** and **`uploads/`** into **`APP_ROOT`** (same paths as above).
3. Restore **`config.json`** / **`.env`** if you use them; **`npm install && npm run build`**; restart **PM2** (or your process manager).

The rest of this document applies to **SQLite-only** installs (`dc-automation.db`, no `DATABASE_URL`).

---

This guide configures the Bash script [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh) to back up the app’s SQLite database (`dc-automation.db` by default) to **Dropbox** using **rclone**, with safe online backups (`sqlite3 .backup`), change detection, retention, and optional alerts.

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

1. If rclone is new on this machine:

   ```bash
   rclone config
   ```

2. Create a **remote** for Dropbox (name is arbitrary; examples below use `dropbox`). Follow the prompts to authorize (browser or token).

3. Confirm access:

   ```bash
   rclone lsd dropbox:
   ```

4. Pick a **dedicated folder** for backups (the script uploads under `…/snapshots/` inside that path). Example remote prefix:

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
| `missing required command` | Install `sqlite3`, `rsync`, `rclone`, `flock` (`util-linux`). |
| `database file not found` | `DB_PATH` wrong or app not deployed yet. |
| rclone auth errors | Re-run `rclone config`, token expiry, remote name matches `RCLONE_REMOTE`. |
| Discord not firing | `curl` installed; webhook URL correct; `python3` for JSON (optional fallback exists). |
| Mail not sending | `mailutils` + working MTA; test with `echo test \| mail -s test you@example.com`. |
| Backups every hour despite no edits | State file not updating—check write permissions on `STATE_FILE` directory; inspect logs for failed steps before state write. |
| On-disk script exits 1 | `APP_ROOT` wrong; or neither `content/wiki` nor `uploads` exists; or `RCLONE_REMOTE_BASE` / `RSYNC_MIRROR` set but `rclone` / `rsync` not installed. |

---

## Related files

- [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh) — implementation and inline comments.
- [`scripts/backup.conf.example`](../scripts/backup.conf.example) — template for `backup.conf`.
- [`scripts/backup-on-disk-files.sh`](../scripts/backup-on-disk-files.sh) — wiki / uploads / optional config tarball + optional rclone and rsync.
- [`scripts/files-backup.conf.example`](../scripts/files-backup.conf.example) — template for `files-backup.conf`.
