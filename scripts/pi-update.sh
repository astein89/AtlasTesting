#!/usr/bin/env bash
# Update Automation Testing on the Pi — follows docs/UPGRADE.md (Quick Upgrade).
# Usage: ./scripts/pi-update.sh [path-to-repo]
# Default repo path: parent of scripts/ (repo root).

set -e

REPO_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"

echo "Upgrading in $REPO_DIR"

# Step 1: Back up the database
if [ -f atlas.db ]; then
  cp atlas.db "atlas.db.backup.$(date +%Y%m%d-%H%M%S)"
  echo "Backed up atlas.db"
fi

# Step 2: Stop the app
pm2 stop automation-testing || true

# Step 3: Get the new code
git pull origin main

# Step 4: Install dependencies
npm install

# Step 5: Build (VITE_BASE_PATH from .env if using base path; see docs/RASPBERRY_PI_SETUP.md)
[ -f .env ] && set -a && . ./.env && set +a
npm run build

# Step 6: Start the app
pm2 start automation-testing || pm2 start ecosystem.config.cjs

echo "Done. Check: pm2 status && pm2 logs automation-testing"
