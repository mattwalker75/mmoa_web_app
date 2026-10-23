// middleware/loginLockout.js — DB-backed brute-force lockout for login.
//
// Tracks failed login attempts in the `login_lockouts` table on TWO axes:
//   - scope 'ip'      → keyed by client IP   (stops one host hammering many accounts)
//   - scope 'account' → keyed by the typed login/email (stops many hosts hammering one account)
// A login is blocked if EITHER axis is currently locked. A successful login
// clears both of the caller's rows.
//
// Behavior (configurable under security.loginLockout): after `maxFailures`
// failures on an axis, that axis is locked for `lockoutSeconds`; the counter
// then resets, so every block of maxFailures buys one cooldown. Lock state is
// stored as an epoch-ms integer (engine-agnostic — no timezone parsing), while
// last_failed_at / updated_at are human-readable for browsing "problem children"
// directly in the table.
//
// NOTE: per-account locking enables a nuisance DoS (an attacker can lock a victim
// out by spamming wrong passwords for their login). The per-IP axis limits the
// blast radius; tune thresholds in config if abuse appears.

const DEFAULTS = { enabled: true, maxFailures: 10, lockoutSeconds: 300 };

function lockoutConfig(appConfig) {
  const c = (appConfig && appConfig.security && appConfig.security.loginLockout) || {};
  const maxFailures = Number.isFinite(c.maxFailures) && c.maxFailures > 0 ? c.maxFailures : DEFAULTS.maxFailures;
  const lockoutSeconds = Number.isFinite(c.lockoutSeconds) && c.lockoutSeconds > 0 ? c.lockoutSeconds : DEFAULTS.lockoutSeconds;
  const enabled = c.enabled !== false;
  return { enabled, maxFailures, lockoutSeconds };
}

// SQL-friendly UTC timestamp 'YYYY-MM-DD HH:MM:SS' (matches the rest of the app).
function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\..+/, '');
}

function getRow(db, scope, key) {
  return db.getAsync(
    'SELECT scope, scope_key, fail_count, locked_until_ms, last_failed_at FROM login_lockouts WHERE scope = ? AND scope_key = ?',
    [scope, key]
  );
}

// Remaining lockout seconds for one axis (0 if not locked).
async function checkScope(db, scope, key, now) {
  const row = await getRow(db, scope, key);
  const until = row && row.locked_until_ms ? Number(row.locked_until_ms) : 0;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

// Is the caller currently locked on either axis? Returns { locked, retryAfter }.
async function checkLockout(db, appConfig, { ip, identifier }) {
  const c = lockoutConfig(appConfig);
  if (!c.enabled) return { locked: false, retryAfter: 0 };
  const now = Date.now();
  let retry = 0;
  if (ip) retry = Math.max(retry, await checkScope(db, 'ip', ip, now));
  if (identifier) retry = Math.max(retry, await checkScope(db, 'account', identifier.toLowerCase(), now));
  return { locked: retry > 0, retryAfter: retry };
}

// Record one failure on a single axis; apply the lock when the threshold is hit.
// Returns remaining lockout seconds for this axis (0 if not newly/locked).
async function bumpScope(db, c, scope, key, now) {
  const ts = sqlTime(now);
  // Portable upsert-increment: UPDATE first; INSERT if the row didn't exist
  // (retry as UPDATE if a concurrent INSERT won the race on the UNIQUE index).
  const upd = await db.runAsync(
    'UPDATE login_lockouts SET fail_count = fail_count + 1, last_failed_at = ?, updated_at = ? WHERE scope = ? AND scope_key = ?',
    [ts, ts, scope, key]
  );
  if (!upd.changes) {
    try {
      await db.runAsync(
        'INSERT INTO login_lockouts (scope, scope_key, fail_count, last_failed_at, updated_at) VALUES (?, ?, 1, ?, ?)',
        [scope, key, ts, ts]
      );
    } catch (e) {
      await db.runAsync(
        'UPDATE login_lockouts SET fail_count = fail_count + 1, last_failed_at = ?, updated_at = ? WHERE scope = ? AND scope_key = ?',
        [ts, ts, scope, key]
      );
    }
  }
  const row = await getRow(db, scope, key);
  const lockedUntil = row && row.locked_until_ms ? Number(row.locked_until_ms) : 0;
  if (row && row.fail_count >= c.maxFailures && lockedUntil <= now) {
    const untilMs = now + c.lockoutSeconds * 1000;
    await db.runAsync(
      'UPDATE login_lockouts SET locked_until_ms = ?, fail_count = 0, updated_at = ? WHERE scope = ? AND scope_key = ?',
      [untilMs, sqlTime(now), scope, key]
    );
    // Observability: surface every lockout so brute-force attempts aren't silent.
    console.warn(`[security] login lockout applied scope=${scope} key=${key} duration=${c.lockoutSeconds}s`);
    return c.lockoutSeconds;
  }
  return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0;
}

// Record a failed login across both axes. Returns { locked, retryAfter }.
async function recordFailure(db, appConfig, { ip, identifier }) {
  const c = lockoutConfig(appConfig);
  if (!c.enabled) return { locked: false, retryAfter: 0 };
  const now = Date.now();
  let retry = 0;
  if (ip) retry = Math.max(retry, await bumpScope(db, c, 'ip', ip, now));
  if (identifier) retry = Math.max(retry, await bumpScope(db, c, 'account', identifier.toLowerCase(), now));
  return { locked: retry > 0, retryAfter: retry };
}

// Clear both axes for the caller (called after a successful login).
async function resetLockout(db, { ip, identifier }) {
  if (ip) await db.runAsync('DELETE FROM login_lockouts WHERE scope = ? AND scope_key = ?', ['ip', ip]);
  if (identifier) await db.runAsync('DELETE FROM login_lockouts WHERE scope = ? AND scope_key = ?', ['account', identifier.toLowerCase()]);
}

// Drop rows that are no longer locked and either have no standing failures or
// haven't failed in a long while (a few wrong passwords that never reached
// maxFailures would otherwise sit in the table forever), so it doesn't
// accumulate stale entries. "A long while" is the larger of 24 h and twice
// lockoutSeconds, so a lock-length configured beyond a day still ages out
// sensibly. A row that is currently locked is always kept. Safe to call
// periodically.
async function cleanup(db, appConfig) {
  const c = lockoutConfig(appConfig);
  const now = Date.now();
  const staleBefore = sqlTime(now - Math.max(24 * 3600, c.lockoutSeconds * 2) * 1000);
  // last_failed_at / updated_at are 'YYYY-MM-DD HH:MM:SS' UTC on both engines
  // (SQLite TEXT compares lexically; MySQL TIMESTAMP compares as a datetime,
  // and the pooled sessions are pinned to UTC) — so one bound string works
  // for both. COALESCE covers a row that somehow has no last_failed_at.
  await db.runAsync(
    `DELETE FROM login_lockouts
      WHERE (locked_until_ms IS NULL OR locked_until_ms <= ?)
        AND (fail_count = 0 OR COALESCE(last_failed_at, updated_at, created_at) < ?)`,
    [now, staleBefore]
  );
}

module.exports = { lockoutConfig, checkLockout, recordFailure, resetLockout, cleanup };
