#!/usr/bin/env bash
# Update DC Automation on the Pi — follows docs/MIGRATION_DC_AUTOMATION.md (Upgrades).
# Usage: ./scripts/pi-update.sh [path-to-repo]
# Default repo path: parent of scripts/ (repo root).

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

# Step 5: Build with base path for reverse proxy at /dc-automation (override with .env if needed)
[ -f .env ] && set -a && . ./.env && set +a
export VITE_BASE_PATH="${VITE_BASE_PATH:-/dc-automation}"
echo "Building with VITE_BASE_PATH=$VITE_BASE_PATH"
npm run build

# Step 6: Start the app
pm2 start dc-automation || pm2 start ecosystem.config.cjs

echo "Done. Check: pm2 status && pm2 logs dc-automation"
