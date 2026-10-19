#!/bin/bash
# RESTART_APP.sh — stops the Web App, pauses, then starts it again.
# Run from the repo root: ./RESTART_APP.sh
#
# Just runs STOP_APP.sh, waits 2 seconds, then START_APP.sh (which launches the
# app detached and returns). Any options are forwarded to START_APP.sh,
# e.g. ./RESTART_APP.sh --force-rebuild.
set -e
cd "$(dirname "$0")"

PAUSE_SECONDS=2

usage() {
  cat <<'EOF'
RESTART_APP.sh — restart the MMoA Web App.

USAGE:
  ./RESTART_APP.sh [START_OPTIONS]

OPTIONS:
  -h, --help        Show this help and exit.
  START_OPTIONS     Anything else is passed straight to START_APP.sh
                    (e.g. --force-rebuild).

BEHAVIOR:
  Runs STOP_APP.sh, waits 2 seconds, then runs START_APP.sh. START launches the
  app detached (nohup, logging to logs/app.log) and returns, so the app keeps
  running after this command exits. Stop it again with STOP_APP.sh.
EOF
}

case "$1" in
  -h|--help) usage; exit 0 ;;
esac

echo "[restart] stopping app…"
./STOP_APP.sh

echo "[restart] waiting ${PAUSE_SECONDS}s…"
sleep "$PAUSE_SECONDS"

echo "[restart] starting app…"
./START_APP.sh "$@"
