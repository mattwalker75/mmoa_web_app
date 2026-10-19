#!/bin/bash
#
#  Setup SQLite database for the mmoa_web_app.
#  Wipes any existing mmoa_web_app.db and rebuilds it from
#  setup_sqlite_db.sql (schema + reference seeds: categories, cities, board
#  roles — no sample content). ALL DATA IS LOST. Uploaded image files in
#  uploads/ are NOT deleted.
#
#  Stop the app first (./STOP_APP.sh) so it isn't holding the old file open.
#  The app also creates the DB automatically on first boot if it is missing,
#  so this is only needed to start over.
#
#############################

cd "$(dirname "$0")"

DB_FILE="mmoa_web_app.db"

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
