#!/usr/bin/env bash
# Update DC Automation on the Pi — follows docs/MIGRATION_DC_AUTOMATION.md (Upgrades).
# Usage: ./scripts/pi-update.sh [path-to-repo]
# Default repo path: parent of scripts/ (repo root).
#
# One-time (clone or new machine): executable bits for this script and ctl.sh; keep Git from
# tracking permission-only noise (especially Linux after chmod or Windows/Linux checkout mix):
#   chmod +x scripts/pi-update.sh scripts/ctl.sh
#   git config core.fileMode false
# See docs/SYSTEM_COMMANDS.md

set -e

REPO_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"

echo "Upgrading in $REPO_DIR"

# Step 1: Back up the database
if [ -f dc-automation.db ]; then
  mkdir -p db_backup
  cp dc-automation.db "db_backup/dc-automation.db.backup.$(date +%Y%m%d-%H%M%S)"
  echo "Backed up dc-automation.db to db_backup/"
elif [ -f dc_automation.db ]; then
  mkdir -p db_backup
  cp dc_automation.db "db_backup/dc_automation.db.backup.$(date +%Y%m%d-%H%M%S)"
  echo "Backed up dc_automation.db to db_backup/ (rename to dc-automation.db when convenient; see docs/MIGRATION_DC_AUTOMATION.md)"
elif [ -f atlas.db ]; then
  mkdir -p db_backup
  cp atlas.db "db_backup/atlas.db.backup.$(date +%Y%m%d-%H%M%S)"
  echo "Backed up atlas.db to db_backup/ (rename to dc-automation.db per docs/MIGRATION_DC_AUTOMATION.md)"
fi

# Step 2: Stop the app
pm2 stop dc-automation || pm2 stop automation-testing || true

# Step 3: Get the new code
git pull origin main

# Step 4: Install dependencies
npm install

# Step 5: Build — default is site root (http://<host>/) per docs/RASPBERRY_PI_SETUP.md. For a subpath
# (e.g. /dc-automation), set VITE_BASE_PATH in .env or export it before running this script.
[ -f .env ] && set -a && . ./.env && set +a
export VITE_BASE_PATH="${VITE_BASE_PATH:-}"
if [ -n "$VITE_BASE_PATH" ]; then
  echo "Building with VITE_BASE_PATH=$VITE_BASE_PATH (subpath URL — match reverse proxy)"
else
  echo "Building for site root (VITE_BASE_PATH unset — e.g. http://<pi-ip>/)"
fi
npm run build

# Step 6: Start the app
pm2 start dc-automation || pm2 start ecosystem.config.cjs

echo "Done. Check: pm2 status && pm2 logs dc-automation"
