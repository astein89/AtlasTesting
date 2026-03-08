#!/usr/bin/env bash
# Control Automation Testing app: start, stop, status, restart, update.
# Usage: ./scripts/ctl.sh <command> [options]
# Commands: start | stop | status | restart | update
# For update: use --yes to skip confirmation (e.g. in scripts).

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

usage() {
  echo "Usage: $0 <command> [options]"
  echo "Commands: start | stop | status | restart | update"
  echo "  update: check for new code, then prompt before upgrading (use --yes to skip confirmation)"
  exit 1
}

CMD="${1:-}"
case "$CMD" in
  start)
    pm2 start automation-testing 2>/dev/null || pm2 start ecosystem.config.cjs
    ;;
  stop)
    pm2 stop automation-testing
    ;;
  status)
    pm2 status
    echo ""
    echo "Logs: pm2 logs automation-testing"
    ;;
  restart)
    pm2 restart automation-testing
    ;;
  update)
    SKIP_CONFIRM=false
    [ "${2:-}" = "-y" ] || [ "${2:-}" = "--yes" ] && SKIP_CONFIRM=true

    git fetch origin 2>/dev/null || true
    UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null)" || UPSTREAM="origin/main"
    BEHIND="$(git rev-list HEAD.."$UPSTREAM" --count 2>/dev/null || echo "0")"

    if [ "${BEHIND:-0}" -eq 0 ]; then
      echo "Already up to date."
      exit 0
    fi

    echo "Updates available ($BEHIND commit(s) behind $UPSTREAM)."
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
