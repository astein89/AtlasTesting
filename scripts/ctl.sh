#!/usr/bin/env bash
# Control DC Automation app: start, stop, status, restart, update.
# Usage: ./scripts/ctl.sh <command> [options]
# Commands: start | stop | status | restart | update
# For update: --yes to skip confirmation; --force to run even when already up to date.

set -e

# Resolve script path so REPO_DIR is correct when this script is run via a symlink (e.g. /usr/local/bin/autotest)
SCRIPT_PATH="$0"
if [ -L "$SCRIPT_PATH" ]; then
  SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH" 2>/dev/null)" || SCRIPT_PATH="$(realpath "$SCRIPT_PATH" 2>/dev/null)" || {
    while [ -L "$SCRIPT_PATH" ]; do
      target="$(readlink "$SCRIPT_PATH")"
      if [ "${target:0:1}" = "/" ]; then
        SCRIPT_PATH="$target"
      else
        SCRIPT_PATH="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)/$target"
      fi
    done
  }
fi
REPO_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
cd "$REPO_DIR"

usage() {
  echo "Usage: $0 <command> [options]"
  echo "Commands: start | stop | status | restart | update"
  echo "  update: check for new code, then prompt (--yes skip confirm, --force run even if up to date)"
  exit 1
}

CMD="${1:-}"
case "$CMD" in
  start)
    pm2 start dc-automation 2>/dev/null || pm2 start ecosystem.config.cjs
    ;;
  stop)
    pm2 stop dc-automation
    ;;
  status)
    pm2 status
    echo ""
    echo "Logs: pm2 logs dc-automation"
    ;;
  restart)
    pm2 restart dc-automation
    ;;
  update)
    SKIP_CONFIRM=false
    FORCE_UPDATE=false
    for arg in "${2:-}" "${3:-}"; do
      [ "$arg" = "-y" ] || [ "$arg" = "--yes" ] && SKIP_CONFIRM=true
      [ "$arg" = "-f" ] || [ "$arg" = "--force" ] && FORCE_UPDATE=true
    done

    git fetch origin 2>/dev/null || true
    UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null)" || UPSTREAM="origin/main"
    BEHIND="$(git rev-list HEAD.."$UPSTREAM" --count 2>/dev/null || echo "0")"

    if [ "${BEHIND:-0}" -eq 0 ] && [ "$FORCE_UPDATE" = false ]; then
      echo "Already up to date."
      exit 0
    fi

    if [ "${BEHIND:-0}" -gt 0 ]; then
      echo "Updates available ($BEHIND commit(s) behind $UPSTREAM)."
    else
      echo "Force update (no new commits)."
    fi
    if [ "$SKIP_CONFIRM" = true ]; then
      :
    elif [ -t 0 ]; then
      printf "Proceed with update? [y/N] "
      read -r ans
      case "${ans:-n}" in
        [yY]|[yY][eE][sS]) ;;
        *) echo "Update cancelled."; exit 0 ;;
      esac
    else
      echo "Run with --yes to update without confirmation (e.g. $0 update --yes)."
      exit 1
    fi
    exec "$REPO_DIR/scripts/pi-update.sh" "$REPO_DIR"
    ;;
  *)
    usage
    ;;
esac
