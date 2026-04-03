# SQLite → Dropbox backup setup

This guide configures the Bash script [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh) to back up the app’s SQLite database (`atlas.db` by default) to **Dropbox** using **rclone**, with safe online backups (`sqlite3 .backup`), change detection, retention, and optional alerts.

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
   dropbox:Backups/automation-testing/sqlite
   ```

   Use **no trailing slash** in config.

---

## 3. Create `backup.conf`

1. Copy the example next to the script (or anywhere you prefer):

   ```bash
   cd /path/to/AutomationTesting/scripts
   cp backup.conf.example backup.conf
   nano backup.conf   # or your editor
   ```

2. Set at least:

   | Variable | Meaning |
   |----------|--------|
   | `DB_PATH` | Absolute path to the **live** `atlas.db` (same file the Node app uses; match `DB_PATH` env if you set it in PM2/systemd). |
   | `STAGING_ROOT` | Local directory for staging, logs, state, and lock (e.g. `/var/lib/automation-testing-backup`). Must be writable by the user that runs the script. |
   | `RCLONE_REMOTE` | e.g. `dropbox:Backups/automation-testing/sqlite` |

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
sudo mkdir -p /var/lib/automation-testing-backup
sudo chown -R deploy:deploy /var/lib/automation-testing-backup
chmod +x /path/to/AutomationTesting/scripts/sqlite-dropbox-backup.sh
```

---

## 5. Test run

Run once manually (as the same user cron will use):

```bash
export BACKUP_CONF=/path/to/scripts/backup.conf   # if not beside the script
/path/to/AutomationTesting/scripts/sqlite-dropbox-backup.sh
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
0 * * * * /usr/bin/flock -n /var/run/atlas-backup.lock -c '/path/to/AutomationTesting/scripts/sqlite-dropbox-backup.sh'
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

---

## Related files

- [`scripts/sqlite-dropbox-backup.sh`](../scripts/sqlite-dropbox-backup.sh) — implementation and inline comments.
- [`scripts/backup.conf.example`](../scripts/backup.conf.example) — template for `backup.conf`.
