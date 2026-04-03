#!/usr/bin/env bash
#
# SQLite online backup → timestamped snapshots (rsync --link-dest) → rclone to Dropbox.
# Intended for cron (e.g. hourly). Requires: bash, sqlite3, rsync, rclone, flock; curl for webhooks.
#
# Usage:
#   cp backup.conf.example backup.conf   # edit paths and RCLONE_REMOTE
#   export BACKUP_CONF=/path/to/backup.conf
#   ./sqlite-dropbox-backup.sh
#
# Cron (hourly, single instance):
#   0 * * * * /usr/bin/flock -n /var/run/atlas-backup.lock -c '/path/to/sqlite-dropbox-backup.sh'
#
# Setup (Debian/Ubuntu/Raspberry Pi OS):
#   sudo apt-get install -y sqlite3 rsync rclone curl
#   rclone config    # e.g. Dropbox remote named "dropbox"
#   cp backup.conf.example backup.conf && edit paths
#   chmod +x sqlite-dropbox-backup.sh
# Optional: mail alerts — install mailutils and configure MTA, or use DISCORD_WEBHOOK only.
# Optional: encryption — create an rclone crypt remote and set RCLONE_REMOTE to it; bandwidth — add --bwlimit to RCLONE_OPTS.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[[ -n "${BACKUP_CONF:-}" && -f "$BACKUP_CONF" ]] && source "$BACKUP_CONF"
# shellcheck source=/dev/null
[[ -z "${BACKUP_CONF:-}" && -f "$SCRIPT_DIR/backup.conf" ]] && source "$SCRIPT_DIR/backup.conf"

: "${DB_PATH:?Set DB_PATH in backup.conf or environment}"
: "${STAGING_ROOT:?Set STAGING_ROOT in backup.conf or environment}"
: "${RCLONE_REMOTE:?Set RCLONE_REMOTE (e.g. dropbox:Backups/atlas) in backup.conf}"

# --- defaults (override in backup.conf) ---
BACKUP_BASENAME="${BACKUP_BASENAME:-dc_automation.db}"
KEEP_LAST="${KEEP_LAST:-24}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-0}"
LOG_FILE="${LOG_FILE:-$STAGING_ROOT/logs/backup.log}"
STATE_FILE="${STATE_FILE:-$STAGING_ROOT/state/last_data_version}"
LOCK_FILE="${LOCK_FILE:-$STAGING_ROOT/run/backup.lock}"
DISCORD_WEBHOOK="${DISCORD_WEBHOOK:-}"
MAIL_TO="${MAIL_TO:-}"
RCLONE_OPTS="${RCLONE_OPTS:---retries 5 --low-level-retries 10 --timeout 2m}"
RUN_INTEGRITY_CHECK="${RUN_INTEGRITY_CHECK:-1}"
LOG_RCLONE="${LOG_RCLONE:-$STAGING_ROOT/logs/rclone.log}"

SNAPSHOTS_DIR="$STAGING_ROOT/snapshots"
REMOTE_SNAPSHOTS="${RCLONE_REMOTE%/}/snapshots"

umask 077
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$STATE_FILE")" "$(dirname "$LOCK_FILE")" "$SNAPSHOTS_DIR"

log() {
  local line="[$(date -Iseconds)] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null || true
}

notify_failure() {
  set +e
  local msg="${1:-Backup step failed on $(hostname)}"
  log "ALERT: $msg"
  if [[ -n "$DISCORD_WEBHOOK" ]]; then
    if command -v curl >/dev/null 2>&1; then
      local payload
      payload="$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps({"content": sys.stdin.read()}))' 2>/dev/null)"
      [[ -z "$payload" ]] && payload="$(printf '{"content":"%s"}' "${msg//\"/\\\"}")"
      curl -sfS -X POST -H "Content-Type: application/json" --data "$payload" \
        "$DISCORD_WEBHOOK" >>"$LOG_FILE" 2>&1 || log "WARN: Discord webhook post failed"
    else
      log "WARN: curl not found; cannot send Discord notification"
    fi
  fi
  if [[ -n "$MAIL_TO" ]] && command -v mail >/dev/null 2>&1; then
    printf '%s\n' "$msg" | mail -s "SQLite backup failure: $(hostname)" "$MAIL_TO" 2>>"$LOG_FILE" || true
  fi
  set -e
}

trap 'notify_failure "Command failed: ${BASH_COMMAND:-?}"; exit 1' ERR

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "FATAL: missing required command: $1"
    exit 1
  }
}

require_cmd sqlite3
require_cmd rsync
require_cmd rclone
require_cmd flock

[[ -f "$DB_PATH" ]] || {
  log "FATAL: database file not found: $DB_PATH"
  notify_failure "Database missing: $DB_PATH"
  exit 1
}

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "Skip: another backup instance holds the lock ($LOCK_FILE)"
  exit 0
fi

# --- change detection: PRAGMA data_version; fallback SHA-256 of file ---
CURRENT_KEY=""
CURRENT_VAL=""
DV_OUT="$(sqlite3 "$DB_PATH" "PRAGMA data_version;" 2>/dev/null | tr -d '\r' | head -1 || true)"
if [[ -n "$DV_OUT" && "$DV_OUT" =~ ^[0-9]+$ ]]; then
  CURRENT_KEY="data_version"
  CURRENT_VAL="$DV_OUT"
  log "PRAGMA data_version=$CURRENT_VAL"
else
  CURRENT_KEY="sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    CURRENT_VAL="$(sha256sum "$DB_PATH" | awk '{print $1}')"
  elif command -v openssl >/dev/null 2>&1; then
    CURRENT_VAL="$(openssl dgst -sha256 "$DB_PATH" | awk '{print $2}')"
  else
    log "FATAL: need sha256sum or openssl for fallback change detection"
    exit 1
  fi
  log "Fallback change detector: sha256=$CURRENT_VAL"
fi

if [[ -f "$STATE_FILE" ]]; then
  LAST_KEY="$(grep '^LAST_KEY=' "$STATE_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
  LAST_VAL="$(grep '^LAST_VAL=' "$STATE_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
  if [[ "$LAST_KEY" == "$CURRENT_KEY" && "$LAST_VAL" == "$CURRENT_VAL" ]]; then
    log "No database changes since last successful backup; skipping."
    exit 0
  fi
fi

TS="$(date +%Y%m%d-%H%M%S)"
NEW_SNAP="$SNAPSHOTS_DIR/$TS"

# Latest existing local snapshot (before mkdir), for --link-dest
PREV_SNAP=""
if [[ -d "$SNAPSHOTS_DIR" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && PREV_SNAP="$SNAPSHOTS_DIR/$line"
  done < <(ls -1 "$SNAPSHOTS_DIR" 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}$' | sort | tail -n 1)
fi
mkdir -p "$NEW_SNAP"

if [[ -n "$PREV_SNAP" && -d "$PREV_SNAP" && "$PREV_SNAP" != "$NEW_SNAP" ]]; then
  log "rsync --link-dest from $(basename "$PREV_SNAP") → $TS"
  rsync -a --delete --link-dest="$PREV_SNAP" "$PREV_SNAP/" "$NEW_SNAP/"
fi

DEST_FILE="$NEW_SNAP/$BACKUP_BASENAME"
log "sqlite3 .backup → $DEST_FILE"
# Use a here-doc so paths with spaces/special chars are handled safely
sqlite3 "$DB_PATH" <<SQL
.backup main '$DEST_FILE'
SQL

if [[ "$RUN_INTEGRITY_CHECK" == "1" ]]; then
  IC="$(sqlite3 "$DEST_FILE" "PRAGMA integrity_check;" | head -1)"
  if [[ "$IC" != "ok" ]]; then
    log "FATAL: integrity_check failed: $IC"
    notify_failure "integrity_check failed for $DEST_FILE: $IC"
    rm -f "$DEST_FILE"
    exit 1
  fi
  log "integrity_check=ok"
fi

log "rclone copy → ${REMOTE_SNAPSHOTS}/$TS/"
mkdir -p "$(dirname "$LOG_RCLONE")"
# shellcheck disable=SC2086
rclone copy "$NEW_SNAP" "${REMOTE_SNAPSHOTS}/${TS}/" \
  $RCLONE_OPTS \
  --log-file "$LOG_RCLONE" --log-level INFO

# Persist state only after successful backup + upload
{
  echo "LAST_KEY=$CURRENT_KEY"
  echo "LAST_VAL=$CURRENT_VAL"
  echo "LAST_TS=$TS"
} >"${STATE_FILE}.tmp"
mv "${STATE_FILE}.tmp" "$STATE_FILE"

# --- local retention: keep only the snapshot we just created (remote holds history) ---
while IFS= read -r d; do
  [[ -z "$d" || "$d" == "$TS" ]] && continue
  rm -rf "${SNAPSHOTS_DIR}/$d"
  log "Removed local snapshot dir: $d"
done < <(ls -1 "$SNAPSHOTS_DIR" 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}$' | grep -v "^${TS}$" || true)

# --- remote retention ---
mapfile -t REMOTE_DIRS < <(rclone lsf "$REMOTE_SNAPSHOTS/" --dirs-only 2>/dev/null | sed 's|/$||' | grep -E '^[0-9]{8}-[0-9]{6}$' | sort || true)
R_COUNT="${#REMOTE_DIRS[@]}"
if (( R_COUNT > KEEP_LAST )); then
  TO_DROP=$((R_COUNT - KEEP_LAST))
  log "Remote prune: removing $TO_DROP oldest snapshot(s); keeping last $KEEP_LAST"
  for ((i = 0; i < TO_DROP; i++)); do
    old="${REMOTE_DIRS[i]}"
    log "rclone purge ${REMOTE_SNAPSHOTS}/${old}/"
    rclone purge "${REMOTE_SNAPSHOTS}/${old}/" $RCLONE_OPTS --log-file "$LOG_RCLONE" --log-level INFO || log "WARN: purge failed for $old"
  done
fi

if [[ "$MAX_AGE_DAYS" =~ ^[0-9]+$ ]] && (( MAX_AGE_DAYS > 0 )); then
  cutoff="$(date -d "-${MAX_AGE_DAYS} days" +%Y%m%d 2>/dev/null || date -v-${MAX_AGE_DAYS}d +%Y%m%d 2>/dev/null || echo "")"
  if [[ -n "$cutoff" ]]; then
    mapfile -t REMOTE_DIRS2 < <(rclone lsf "$REMOTE_SNAPSHOTS/" --dirs-only 2>/dev/null | sed 's|/$||' | grep -E '^[0-9]{8}-[0-9]{6}$' | sort || true)
    for name in "${REMOTE_DIRS2[@]}"; do
      day="${name%%-*}"
      if [[ "$day" < "$cutoff" ]]; then
        log "Remote age prune: ${REMOTE_SNAPSHOTS}/${name}/ (older than $MAX_AGE_DAYS days)"
        rclone purge "${REMOTE_SNAPSHOTS}/${name}/" $RCLONE_OPTS --log-file "$LOG_RCLONE" --log-level INFO || log "WARN: age purge failed for $name"
      fi
    done
  fi
fi

trap - ERR
log "Done: snapshot $TS uploaded and retention applied."
exit 0
