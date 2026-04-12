#!/usr/bin/env bash
#
# Back up DC Automation on-disk data: content/wiki, uploads, optional wiki-seed / config.
# Creates a timestamped tar.gz under ARCHIVE_DIR and optionally mirrors with rclone and/or rsync.
# Does NOT back up the database — use sqlite-dropbox-backup.sh, pg_dump, or host backups for that.
#
# Usage:
#   cp files-backup.conf.example files-backup.conf && nano files-backup.conf
#   export FILES_BACKUP_CONF=/path/to/files-backup.conf   # optional if beside this script
#   chmod +x backup-on-disk-files.sh
#   ./backup-on-disk-files.sh
#
# Cron (daily example):
#   15 2 * * * /path/to/dc-automation/scripts/backup-on-disk-files.sh >>/var/log/dc-automation-files-backup.log 2>&1
#
# Requires: bash, tar, flock; optional: rclone, rsync
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[[ -n "${FILES_BACKUP_CONF:-}" && -f "$FILES_BACKUP_CONF" ]] && source "$FILES_BACKUP_CONF"
# shellcheck source=/dev/null
[[ -z "${FILES_BACKUP_CONF:-}" && -f "$SCRIPT_DIR/files-backup.conf" ]] && source "$SCRIPT_DIR/files-backup.conf"

APP_ROOT="${APP_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ARCHIVE_DIR="${ARCHIVE_DIR:-${HOME}/backups/dc-automation-files}"
ENABLE_TAR="${ENABLE_TAR:-1}"
RCLONE_REMOTE_BASE="${RCLONE_REMOTE_BASE:-}"
RCLONE_OPTS="${RCLONE_OPTS:---retries 5 --low-level-retries 10 --timeout 2m}"
RSYNC_MIRROR="${RSYNC_MIRROR:-}"
LOG_FILE="${LOG_FILE:-$ARCHIVE_DIR/logs/files-backup.log}"
LOCK_FILE="${LOCK_FILE:-$ARCHIVE_DIR/run/files-backup.lock}"

umask 077
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$LOCK_FILE")" "$ARCHIVE_DIR"

log() {
  local line="[$(date -Iseconds)] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null || true
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "SKIP: lock held ($LOCK_FILE)"
  exit 0
fi

if [[ ! -d "$APP_ROOT" ]]; then
  log "ERROR: APP_ROOT is not a directory: $APP_ROOT"
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M)
parts=()
cd "$APP_ROOT" || exit 1

[[ -d content/wiki ]] && parts+=("content/wiki")
[[ -d uploads ]] && parts+=("uploads")
[[ -d content/wiki-seed ]] && parts+=("content/wiki-seed")
[[ -f content/home-intro.md ]] && parts+=("content/home-intro.md")
[[ -f config.json ]] && parts+=("config.json")
[[ -f scripts/backup.conf ]] && parts+=("scripts/backup.conf")

if [[ ${#parts[@]} -eq 0 ]]; then
  log "ERROR: nothing to back up under $APP_ROOT (expected content/wiki and/or uploads, etc.)"
  exit 1
fi

ARCHIVE_PATH="$ARCHIVE_DIR/dc-automation-files-$STAMP.tar.gz"

if [[ "$ENABLE_TAR" == "1" ]]; then
  log "Creating tarball: $ARCHIVE_PATH"
  tar -czf "$ARCHIVE_PATH" "${parts[@]}"
  log "OK: tarball ($ARCHIVE_PATH)"
else
  log "SKIP: ENABLE_TAR=$ENABLE_TAR (no tarball)"
fi

if [[ -n "$RCLONE_REMOTE_BASE" ]]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR: rclone not found but RCLONE_REMOTE_BASE is set"
    exit 1
  fi
  DEST="${RCLONE_REMOTE_BASE%/}/$STAMP"
  log "rclone → $DEST"
  if [[ -d "$APP_ROOT/content/wiki" ]]; then
    # shellcheck disable=SC2086
    rclone copy "$APP_ROOT/content/wiki" "$DEST/content/wiki" $RCLONE_OPTS
  fi
  if [[ -d "$APP_ROOT/uploads" ]]; then
    # shellcheck disable=SC2086
    rclone copy "$APP_ROOT/uploads" "$DEST/uploads" $RCLONE_OPTS
  fi
  if [[ -d "$APP_ROOT/content/wiki-seed" ]]; then
    # shellcheck disable=SC2086
    rclone copy "$APP_ROOT/content/wiki-seed" "$DEST/content/wiki-seed" $RCLONE_OPTS
  fi
  if [[ -f "$APP_ROOT/content/home-intro.md" ]]; then
    # shellcheck disable=SC2086
    rclone copy "$APP_ROOT/content/home-intro.md" "$DEST/content/" $RCLONE_OPTS
  fi
  if [[ -f "$APP_ROOT/config.json" ]]; then
    # shellcheck disable=SC2086
    rclone copy "$APP_ROOT/config.json" "$DEST/" $RCLONE_OPTS
  fi
  if [[ -f "$APP_ROOT/scripts/backup.conf" ]]; then
    # shellcheck disable=SC2086
    rclone copy "$APP_ROOT/scripts/backup.conf" "$DEST/scripts/" $RCLONE_OPTS
  fi
  log "OK: rclone upload complete"
fi

if [[ -n "$RSYNC_MIRROR" ]]; then
  if ! command -v rsync >/dev/null 2>&1; then
    log "ERROR: rsync not found but RSYNC_MIRROR is set"
    exit 1
  fi
  mkdir -p "$RSYNC_MIRROR"
  log "rsync mirror → $RSYNC_MIRROR"
  if [[ -d "$APP_ROOT/content/wiki" ]]; then
    mkdir -p "$RSYNC_MIRROR/content/wiki"
    rsync -a --delete "$APP_ROOT/content/wiki/" "$RSYNC_MIRROR/content/wiki/"
  fi
  if [[ -d "$APP_ROOT/uploads" ]]; then
    mkdir -p "$RSYNC_MIRROR/uploads"
    rsync -a --delete "$APP_ROOT/uploads/" "$RSYNC_MIRROR/uploads/"
  fi
  log "OK: rsync mirror complete"
fi

log "Done (APP_ROOT=$APP_ROOT)"
exit 0
