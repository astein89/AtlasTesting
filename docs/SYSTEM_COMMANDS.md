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

1. Make the control and update scripts executable (required for `./scripts/...`; symlinks need the target file to be `+x` or you get “Permission denied”):

```bash
cd /path/to/dc-automation   # your repo path
chmod +x scripts/ctl.sh scripts/pi-update.sh
```

**Git and `chmod`:** On Linux the executable bit often differs from what Git recorded on Windows. After `chmod +x`, `git status` may list the scripts as modified even though only permissions changed. In this repo only, you can stop tracking mode-only differences:

```bash
cd /path/to/dc-automation
git config core.fileMode false
```

That sets **local** config (not committed). Content edits are still detected; only permission-only noise is ignored.

2. Create the symlink (use your actual repo path instead of `/path/to/dc-automation`):

```bash
sudo ln -s /path/to/dc-automation/scripts/ctl.sh /usr/local/bin/dca
```

3. Run from anywhere:

```bash
dca status
dca update
```

The script changes into the repo directory before running PM2 or the update script, so the symlink can live anywhere.

## Prerequisites

- **PM2** — Install with `npm install -g pm2`. Used for start, stop, status, restart.
- **Update command** — Requires git, npm, and the project’s [scripts/pi-update.sh](../scripts/pi-update.sh). The app is expected to be managed by PM2 (see [Raspberry Pi Setup](RASPBERRY_PI_SETUP.md) and [Upgrades](MIGRATION_DC_AUTOMATION.md#upgrades-after-you-use-dc-automation) in the migration guide).

The default install serves at **http://\<pi-ip\>/** (Caddy 2 or nginx on port 80 → Node). If you use a **subpath** (e.g. http://\<pi-ip\>/dc-automation), set `BASE_PATH` and `VITE_BASE_PATH` as in [Raspberry Pi Install & Setup](RASPBERRY_PI_SETUP.md).

## Troubleshooting

### `-bash: /usr/local/bin/dca: Permission denied`

The symlink is not what must be executable — the **file it points to** (`.../scripts/ctl.sh`) needs **`+x`**. After a fresh `git clone`, the bit is often missing.

**Fix** (use your real repo path, or resolve the symlink target):

```bash
chmod +x ~/dc-automation/scripts/ctl.sh ~/dc-automation/scripts/pi-update.sh
```

Or from the symlink alone:

```bash
CTL="$(readlink -f /usr/local/bin/dca)"
chmod +x "$CTL" "$(dirname "$CTL")/pi-update.sh"
```

Then run `dca update` again. If `git status` shows only mode changes on those files, use **`git config core.fileMode false`** in the repo ([section above](#add-a-system-wide-command-optional)).

## See also

- [Raspberry Pi Install & Setup](RASPBERRY_PI_SETUP.md)
- [Migration & upgrades](MIGRATION_DC_AUTOMATION.md)
