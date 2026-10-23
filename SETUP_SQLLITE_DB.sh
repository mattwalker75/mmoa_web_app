#!/bin/bash
#
#  Setup SQLite database for the mmoa_web_app.
#  Wipes any existing mmoa_web_app.db and rebuilds it from
#  setup_sqlite_db.sql (schema + reference seeds: categories, cities, board
#  roles — no sample content). ALL DATA IS LOST. Uploaded image files in
#  uploads/ are NOT deleted.
#
#  Stop the app first (./STOP_APP.sh) so it isn't holding the old file open —
#  this script refuses to run while it is (PID file, the DB file open, or the
#  configured port in use). The app also creates the DB automatically on
#  first boot if it is missing, so this is only needed to start over.
#
#############################

cd "$(dirname "$0")"

DB_FILE="mmoa_web_app.db"
PID_FILE="tmp/app.pid"

#############################
#
#  Refuse while the app is running: deleting the file under a live process
#  leaves it writing to an unlinked database (every change silently lost).
#
app_pid_alive() {
  local pid="$1"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -q 'node.*app\.js'
}
RUNNING=""
if [ -f "$PID_FILE" ] && app_pid_alive "$(cat "$PID_FILE" 2>/dev/null)"
then
   RUNNING="the app is running (PID $(cat "$PID_FILE"))"
elif command -v lsof > /dev/null 2>&1
then
   PORT="$(node -e "try{process.stdout.write(String(require('./config.json').port||3004))}catch(e){process.stdout.write('3004')}" 2>/dev/null || echo 3004)"
   if [ -f "$DB_FILE" ] && [ -n "$(lsof -t "$DB_FILE" 2>/dev/null)" ]
   then
      RUNNING="$DB_FILE is open by another process (PID $(lsof -t "$DB_FILE" 2>/dev/null | xargs))"
   elif [ -n "$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null)" ]
   then
      RUNNING="something is listening on port $PORT (the app?)"
   fi
fi
if [ -n "$RUNNING" ]
then
   echo "Refusing to rebuild $DB_FILE: $RUNNING."
   echo "Run ./STOP_APP.sh first (and close any other sqlite3 / admin console session on the file), then try again."
   exit 1
fi

which sqlite3 > /dev/null 2>&1
if (( $? != 0 ))
then
   echo "Install SQLite on your computer"
   echo "RUN:  brew install sqlite      (macOS)"
   echo "RUN:  sudo yum install sqlite  (Amazon Linux)"
   exit 255
fi

echo "Removing SQLite database"
rm -f "$DB_FILE" "$DB_FILE-journal" "$DB_FILE-wal" "$DB_FILE-shm"

echo "Creating a new SQLite database"
sqlite3 "$DB_FILE" < setup_sqlite_db.sql
if (( $? != 0 ))
then
   echo "Failed to build $DB_FILE from setup_sqlite_db.sql"
   exit 1
fi
echo "Created $DB_FILE"
