#!/bin/bash
# START_APP.sh — boots the Web App in the background.
# Run from the repo root: ./START_APP.sh
#
# Setup is folded in: on a fresh clone this installs deps and builds the SPA
# automatically, then starts. On normal restarts it skips straight to start
# (instant, no network needed) because node_modules/ and the SPA build already
# exist. Use --force-rebuild after changing dependencies or frontend source to
# force a reinstall + rebuild.
#
# The app is launched detached with nohup (so it keeps running after this script
# and the shell/SSM session exit). Its PID is written to tmp/app.pid and its
# output to logs/app.log, so STOP_APP.sh / RESTART_APP.sh can find and manage
# it. Both live inside the project tree.
#
# Log rotation: logs/app.log only ever grows (one line per request), so before
# each launch, if it is over LOG_MAX_MB it is moved aside to logs/app.log.1
# (replacing any older .1). That caps disk use at roughly 2 × LOG_MAX_MB; a
# long-running instance that is never restarted is not rotated — restart it
# (./RESTART_APP.sh) now and then, or add logrotate.
#
# NODE_ENV defaults to "production" (unless already set in the environment):
# Express then never renders an error's stack trace into a response.
set -e
cd "$(dirname "$0")"

mkdir -p logs tmp
PID_FILE="tmp/app.pid"    # records the running app's PID for STOP/RESTART
LOG_FILE="logs/app.log"   # detached app output goes here
LOG_MAX_MB=50             # rotate app.log → app.log.1 above this size

# Is PID a live copy of THIS app? After a reboot tmp/app.pid can still name a
# PID the OS has since handed to an unrelated process, so a bare `kill -0`
# isn't enough: the command line has to look like "node … app.js" too.
app_pid_alive() {
  local pid="$1"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -q 'node.*app\.js'
}

# Web URL the Web App serves on (mirrors app.js's boot line) — echoed to
# the terminal after start so developers know where to reach it.
WEB_URL="$(node -e "try{const c=require('./config.json');process.stdout.write(((c.server&&c.server.ssl)?'https':'http')+'://localhost:'+(c.port||3004))}catch(e){process.stdout.write('http://localhost:3004')}" 2>/dev/null || echo 'http://localhost:3004')"

usage() {
  cat <<'EOF'
START_APP.sh — boot the MMoA Web App (runs in the background).

USAGE:
  ./START_APP.sh [OPTIONS]

OPTIONS:
  --force-rebuild   Reinstall dependencies and rebuild the frontend before
                    starting, even if they already exist. Use this after
                    changing dependencies or editing frontend source code.
  -h, --help        Show this help and exit.

BEHAVIOR:
  With no options, setup runs only when needed:
    - Installs backend dependencies if node_modules/ is missing.
    - Builds the frontend if its dist/ build is missing.
    - Otherwise skips straight to starting the app.

  Because the check is "does a build exist?" (not "is it up to date?"), a plain
  start will NOT pick up edits to frontend source — rerun with --force-rebuild
  after changing code to rebuild the SPA.

  The app is launched detached (nohup): its PID is saved to tmp/app.pid and
  output to logs/app.log. It keeps running after this script exits. Stop it
  with STOP_APP.sh; restart it with RESTART_APP.sh.

EXAMPLES:
  ./START_APP.sh                  # normal boot (build only if missing)
  ./START_APP.sh --force-rebuild  # reinstall + rebuild, then boot
EOF
}

case "$1" in
  -h|--help)
    usage
    exit 0
    ;;
  --force-rebuild)
    echo "[start] --force-rebuild: reinstalling deps and rebuilding the frontend…"
    npm install
    npm run build:frontend
    ;;
  "")
    # Backend deps. npm run build:frontend already installs the frontend's own
    # deps before building, so a present dist/ implies both are in place.
    [ -d node_modules ] || { echo "[start] installing backend deps…"; npm install; }
    [ -d frontend/mmoa-web-ui/dist ] || { echo "[start] building frontend…"; npm run build:frontend; }
    ;;
  *)
    echo "[start] unknown option: $1" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac

# Don't start a second copy if one is already running; drop a stale PID file.
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null)"
  if app_pid_alive "$OLD_PID"; then
    echo "[start] app is already running (PID $OLD_PID). Use ./RESTART_APP.sh or ./STOP_APP.sh."
    exit 0
  fi
  echo "[start] removing stale $PID_FILE (PID ${OLD_PID:-?} is not a running copy of this app)."
  rm -f "$PID_FILE"
fi

# Size-based log rotation (see the header comment).
if [ -f "$LOG_FILE" ]; then
  LOG_BYTES="$(wc -c < "$LOG_FILE" | tr -d ' ')"
  if [ "${LOG_BYTES:-0}" -gt $((LOG_MAX_MB * 1024 * 1024)) ]; then
    echo "[start] $LOG_FILE is over ${LOG_MAX_MB} MB — rotating to $LOG_FILE.1"
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi
fi

export NODE_ENV="${NODE_ENV:-production}"

echo "[start] launching Web App (detached; NODE_ENV=$NODE_ENV; logs → $LOG_FILE)…"
nohup node app.js >> "$LOG_FILE" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

# Confirm it actually came up rather than exiting immediately (e.g. bad config).
sleep 1
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "[start] app started (PID $APP_PID)."
  echo "[start] Web App listening on $WEB_URL"
  echo "[start] Stop with ./STOP_APP.sh; tail logs with: tail -f $LOG_FILE"
else
  echo "[start] app failed to start — see $LOG_FILE" >&2
  rm -f "$PID_FILE"
  exit 1
fi
