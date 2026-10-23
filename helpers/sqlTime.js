// helpers/sqlTime.js — engine-agnostic timestamp helpers shared by the routes
// and scripts (routes/api.js re-exports them for older callers).

'use strict';

// SQL-friendly UTC timestamp 'YYYY-MM-DD HH:MM:SS' (what SQLite
// CURRENT_TIMESTAMP emits, and what MySQL accepts for TIMESTAMP columns).
// All app-side writes use this instead of CURRENT_TIMESTAMP / datetime() so
// both engines store the same UTC value.
function sqlTime(date) {
  return new Date(date).toISOString().replace('T', ' ').replace(/\..+/, '');
}

// Parse a SQL timestamp to epoch ms, engine-agnostically. SQLite returns a
// 'YYYY-MM-DD HH:MM:SS' UTC string; MySQL (mysql2) returns a JS Date object.
// A naive `new Date(row.expires_at + 'Z')` yields Invalid Date → NaN on
// MySQL, so `Date.now() > NaN` is always false and tokens would NEVER
// expire. Returns NaN if unparseable; callers fail closed (treat NaN as
// expired) for security tokens.
function parseSqlTimeMs(t) {
  if (t == null) return NaN;
  if (t instanceof Date) return t.getTime();
  const s = String(t);
  // Append 'Z' unless the string already ends in a zone designator (Z or
  // ±hh:mm / ±hhmm) — both alternatives anchored, so a 'z' elsewhere in a
  // garbage string can't suppress it.
  const iso = s.replace(' ', 'T') + (/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s) ? '' : 'Z');
  return Date.parse(iso);
}

// Timestamp → ISO-8601 UTC string for JSON output (null when missing or
// unparseable), so the SPA sees one format whichever engine is underneath.
function isoOrNull(t) {
  const ms = parseSqlTimeMs(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

module.exports = { sqlTime, parseSqlTimeMs, isoOrNull };
