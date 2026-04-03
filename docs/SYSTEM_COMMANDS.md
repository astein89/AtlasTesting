# System commands — app control (start, stop, status, update)

A single script controls the DC Automation app: **start**, **stop**, **status**, **restart**, and **update** (run the upgrade flow).

## How to run it (from repo)

From the project root:

```bash
./scripts/ctl.sh <command>
```

Or via npm (pass the command after `--`):

```bash
npm run ctl -- <command>
```

**Commands:**

| Command   | Action |
|----------|--------|
| `start`  | Start the app with PM2 (or add it from `ecosystem.config.cjs` if not already in PM2). |
| `stop`   | Stop the app. |
| `status` | Show PM2 status and a hint to view logs (`pm2 logs dc-automation`). |
| `restart`| Restart the app. |
| `update` | Check for new commits; if any, prompt then run full upgrade (backup → stop → pull → install → build → start). Same as [scripts/pi-update.sh](../scripts/pi-update.sh). |

**Update options** (after `update`): `--yes` to skip the confirmation prompt; `--force` to run the upgrade even when there are no new commits (e.g. to reinstall deps or rebuild).

Examples:

```bash
./scripts/ctl.sh status
./scripts/ctl.sh update
./scripts/ctl.sh update --force --yes
npm run ctl -- restart
```

## Add a system-wide command (optional)

You can call the script from anywhere by linking it into a directory on your `PATH` (e.g. `/usr/local/bin`).

**On Linux / Raspberry Pi:**

1. Make the script executable (required when using a symlink; otherwise you may get "Permission denied"):

```bash
cd /path/to/dc-automation   # your repo path
chmod +x scripts/ctl.sh
```

2. Create the symlink (use your actual repo path instead of `/path/to/dc-automation`):

```bash
sudo ln -s /path/to/dc-automation/scripts/ctl.sh /usr/local/bin/autotest
```

3. Run from anywhere:

```bash
autotest status
autotest update
```

The script changes into the repo directory before running PM2 or the update script, so the symlink can live anywhere.

## Prerequisites

- **PM2** — Install with `npm install -g pm2`. Used for start, stop, status, restart.
- **Update command** — Requires git, npm, and the project’s [scripts/pi-update.sh](../scripts/pi-update.sh). The app is expected to be managed by PM2 (see [Raspberry Pi Setup](RASPBERRY_PI_SETUP.md) and [Upgrade Instructions](UPGRADE.md)).

The default install serves at **http://\<pi-ip\>/** (Caddy 2 or nginx on port 80 → Node). If you use a **subpath** (e.g. http://\<pi-ip\>/dc-automation), set `BASE_PATH` and `VITE_BASE_PATH` as in [Raspberry Pi Install & Setup](RASPBERRY_PI_SETUP.md).

## See also

- [Raspberry Pi Install & Setup](RASPBERRY_PI_SETUP.md)
- [Upgrade Instructions](UPGRADE.md)
