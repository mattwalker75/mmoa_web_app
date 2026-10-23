#!/usr/bin/env bash
#
# maintenance.sh — toggle the MMoA web app into / out of maintenance mode.
#
# Writes maintenance.json in the project root (atomically: temp file + rename,
# so the server never reads a half-written file). The Express server reads
# that file live (helpers/maintenance.js), so changes take effect immediately
# with no restart.
#
# Usage:
#   scripts/maintenance.sh --enable --title "Title message" --message "Detailed message"
#   scripts/maintenance.sh --disable
#   scripts/maintenance.sh --status
#
# Options:
#   --enable            Turn maintenance mode ON.
#   --disable           Turn maintenance mode OFF (site behaves normally).
#   --title   <text>    Heading shown large/centered on the maintenance screen.
#   --message <text>    Detailed text shown smaller below the title.
#   --status            Print the current maintenance state and exit.
#   -h, --help          Show this help.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="$ROOT_DIR/maintenance.json"

usage() {
  sed -n '3,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

ACTION=""
TITLE=""
MESSAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --enable)
      ACTION="enable"; shift ;;
    --disable)
      ACTION="disable"; shift ;;
    --status)
      ACTION="status"; shift ;;
    --title)
      [[ $# -ge 2 ]] || { echo "Error: --title requires a value" >&2; exit 1; }
      TITLE="$2"; shift 2 ;;
    --message)
      [[ $# -ge 2 ]] || { echo "Error: --message requires a value" >&2; exit 1; }
      MESSAGE="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Error: unknown argument '$1'" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1 ;;
  esac
done

if [[ -z "$ACTION" ]]; then
  echo "Error: specify --enable, --disable, or --status." >&2
  echo "Run '$0 --help' for usage." >&2
  exit 1
fi

# Resolve a node binary (project is Node-based; use it for safe JSON I/O).
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Error: 'node' not found on PATH (required for safe JSON handling)." >&2
  exit 1
fi

case "$ACTION" in
  status)
    if [[ -f "$STATE_FILE" ]]; then
      "$NODE_BIN" -e '
        const fs = require("fs");
        try {
          const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          if (s && s.enabled === true) {
            console.log("Maintenance mode: ENABLED");
            console.log("  Title:   " + (s.title || "(default)"));
            console.log("  Message: " + (s.message || "(default)"));
            if (s.since) console.log("  Since:   " + s.since);
          } else {
            console.log("Maintenance mode: disabled");
          }
        } catch (e) {
          console.log("Maintenance mode: disabled (state file unreadable)");
        }
      ' "$STATE_FILE"
    else
      echo "Maintenance mode: disabled (no state file)"
    fi
    ;;

  enable)
    DEFAULT_TITLE="We’ll be right back"
    DEFAULT_MESSAGE="The site is temporarily down for scheduled maintenance. Please check back shortly."
    [[ -n "$TITLE" ]]   || TITLE="$DEFAULT_TITLE"
    [[ -n "$MESSAGE" ]] || MESSAGE="$DEFAULT_MESSAGE"

    # Pass title/message via env so node never has to parse shell-quoted text.
    MT_TITLE="$TITLE" MT_MESSAGE="$MESSAGE" "$NODE_BIN" -e '
      const fs = require("fs");
      const out = {
        enabled: true,
        title: process.env.MT_TITLE || "",
        message: process.env.MT_MESSAGE || "",
        since: new Date().toISOString()
      };
      // Write to a temp file and rename it into place: the server reads the
      // file live on every request, so it must never see a truncated copy.
      const tmp = process.argv[1] + ".tmp." + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
      fs.renameSync(tmp, process.argv[1]);
    ' "$STATE_FILE"

    echo "Maintenance mode ENABLED."
    echo "  Title:   $TITLE"
    echo "  Message: $MESSAGE"
    echo "  State:   $STATE_FILE"
    ;;

  disable)
    # Write an explicit disabled state (keeps the file for auditability) and
    # also blank it so a stale 'enabled' can never linger.
    "$NODE_BIN" -e '
      const fs = require("fs");
      const out = { enabled: false, since: new Date().toISOString() };
      // Write to a temp file and rename it into place: the server reads the
      // file live on every request, so it must never see a truncated copy.
      const tmp = process.argv[1] + ".tmp." + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
      fs.renameSync(tmp, process.argv[1]);
    ' "$STATE_FILE"

    echo "Maintenance mode DISABLED. The site is serving normally."
    ;;
esac
