#!/bin/bash
# STOP_APP.sh — stops the Web App.
# Run from the repo root: ./STOP_APP.sh
#
# Finds the running app two ways and stops whatever it finds:
#   1. the PID recorded in tmp/app.pid by START_APP.sh, and
#   2. whatever process is listening on the app's configured port.
# It asks the process to stop gracefully (SIGTERM), waits a few seconds, then
# force-kills (SIGKILL) anything still alive.
cd "$(dirname "$0")"

PID_FILE="tmp/app.pid"
GRACE_SECONDS=10   # how long to wait for a graceful shutdown before SIGKILL

usage() {
  cat <<'EOF'
STOP_APP.sh — stop the MMoA Web App.

USAGE:
  ./STOP_APP.sh [OPTIONS]

OPTIONS:
  -h, --help   Show this help and exit.

BEHAVIOR:
  Locates the app by the PID in tmp/app.pid (written by START_APP.sh) and by the
  process listening on the configured port (from config.json, default 3004).
  Sends SIGTERM for a clean shutdown, waits up to 10s, then SIGKILL if needed.
  Exits 0 if the app is stopped (or was already not running).
EOF
}

case "$1" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) echo "[stop] unknown option: $1" >&2; echo >&2; usage >&2; exit 1 ;;
esac

# Resolve the app's port from config.json (fall back to the app default, 3004).
PORT="$(node -e "try{process.stdout.write(String(require('./config.json').port||3004))}catch(e){process.stdout.write('3004')}" 2>/dev/null || echo 3004)"

# Collect candidate PIDs: the recorded one, plus whoever is listening on PORT.
PIDS=""
if [ -f "$PID_FILE" ]; then
  PIDS="$PIDS $(cat "$PID_FILE" 2>/dev/null)"
fi
if command -v lsof >/dev/null 2>&1; then
  PIDS="$PIDS $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null)"
fi

# De-duplicate and keep only PIDs that are actually alive.
ALIVE=""
for pid in $PIDS; do
  case " $ALIVE " in *" $pid "*) continue ;; esac          # already seen
  [ -n "$pid" ] || continue
  if kill -0 "$pid" 2>/dev/null; then
    ALIVE="$ALIVE $pid"
  fi
done
ALIVE="$(echo "$ALIVE" | xargs 2>/dev/null)"

if [ -z "$ALIVE" ]; then
  echo "[stop] app is not running (nothing on the PID file or port $PORT)."
  rm -f "$PID_FILE"
  exit 0
fi

echo "[stop] stopping app (PID(s): $ALIVE) — sending SIGTERM…"
for pid in $ALIVE; do kill -TERM "$pid" 2>/dev/null || true; done

# Wait for graceful shutdown.
for _ in $(seq 1 "$GRACE_SECONDS"); do
  STILL=""
  for pid in $ALIVE; do
    kill -0 "$pid" 2>/dev/null && STILL="$STILL $pid"
  done
  [ -z "$STILL" ] && break
  sleep 1
done

# Force-kill anything that ignored SIGTERM.
STILL="$(echo "$STILL" | xargs 2>/dev/null)"
if [ -n "$STILL" ]; then
  echo "[stop] still running after ${GRACE_SECONDS}s — sending SIGKILL to: $STILL"
  for pid in $STILL; do kill -KILL "$pid" 2>/dev/null || true; done
fi

rm -f "$PID_FILE"
echo "[stop] app stopped."
