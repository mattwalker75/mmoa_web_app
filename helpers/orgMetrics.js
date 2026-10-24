// helpers/orgMetrics.js — anonymous usage counts per nonprofit.
//
// What is counted (KINDS): 'search' (the org appeared in a Need Help result
// list — counted server-side in routes/public.js), 'view' (its full profile
// page was opened) and one kind per link used (call, directions, website,
// email, facebook, instagram, other_link) — those arrive from the SPA as a
// beacon (POST /api/metrics). Totals only: no IPs, cookies or visitor ids.
//
// Storage (org_metrics): counts are added to an in-memory map and written
// ONCE AN HOUR into 'hour' buckets (bucket_start = the UTC hour). A process
// restart loses at most the current hour — accepted. The daily rollup keeps
// the table small:
//     hours older than 7 days  → one 'day' row per org/kind/day
//     days  older than 28 days → one 'week' row per org/kind/week (Mon UTC)
//     anything older than 5 years is deleted
// All SQL is portable (SQLite + MySQL): UPDATE-then-INSERT upserts, no
// engine-specific date functions (bucket boundaries are computed here).

'use strict';

const { sqlTime, parseSqlTimeMs } = require('./sqlTime');

const KINDS = ['search', 'view', 'call', 'directions', 'website', 'email', 'facebook', 'instagram', 'other_link'];
const LINK_KINDS = KINDS.filter(k => k !== 'search' && k !== 'view');
const BEACON_KINDS = KINDS.filter(k => k !== 'search'); // what the SPA may report
const HOUR = 3600 * 1000, DAY = 24 * HOUR, WEEK = 7 * DAY;
const KEEP_HOURS_MS = 7 * DAY, KEEP_DAYS_MS = 28 * DAY, KEEP_ALL_MS = 5 * 365 * DAY;

const hourStart = (ms) => sqlTime(Math.floor(ms / HOUR) * HOUR);
const dayStart = (ms) => sqlTime(Math.floor(ms / DAY) * DAY);
// ISO weeks start Monday; epoch day 0 (1970-01-01) was a Thursday.
const weekStart = (ms) => sqlTime(Math.floor((ms + 3 * DAY) / WEEK) * WEEK - 3 * DAY);

// ── counting ─────────────────────────────────────────────────────────────
const pending = new Map(); // "org|kind|hourStart" → n

function bump(orgId, kind, n = 1) {
  if (!Number.isInteger(orgId) || orgId <= 0 || !KINDS.includes(kind)) return false;
  const key = `${orgId}|${kind}|${hourStart(Date.now())}`;
  pending.set(key, (pending.get(key) || 0) + n);
  return true;
}

/** Portable "add n to the row, creating it if missing". */
async function addTo(db, orgId, kind, bucket, start, n) {
  const upd = await db.runAsync(
    'UPDATE org_metrics SET n = n + ? WHERE org_id = ? AND kind = ? AND bucket = ? AND bucket_start = ?',
    [n, orgId, kind, bucket, start]);
  if (upd.changes) return;
  try {
    await db.runAsync('INSERT INTO org_metrics (org_id, kind, bucket, bucket_start, n) VALUES (?, ?, ?, ?, ?)',
      [orgId, kind, bucket, start, n]);
  } catch (e) { // lost a race on the UNIQUE key — add instead
    await db.runAsync(
      'UPDATE org_metrics SET n = n + ? WHERE org_id = ? AND kind = ? AND bucket = ? AND bucket_start = ?',
      [n, orgId, kind, bucket, start]);
  }
}

/** Write the in-memory counts to the database. Returns the number of rows touched. */
async function flush(db) {
  if (!pending.size) return 0;
  const snapshot = [...pending.entries()];
  pending.clear();
  let written = 0;
  for (const [key, n] of snapshot) {
    const [org, kind, start] = key.split('|');
    try {
      await addTo(db, Number(org), kind, 'hour', start, n);
      written++;
    } catch (e) {
      // Put it back for the next flush (table not created yet, DB down…).
      pending.set(key, (pending.get(key) || 0) + n);
      throw e;
    }
  }
  return written;
}

// ── rollup ───────────────────────────────────────────────────────────────
async function rollBucket(db, from, to, cutoffMs, startOf) {
  const cutoff = sqlTime(cutoffMs);
  const rows = await db.allAsync(
    'SELECT org_id, kind, bucket_start, n FROM org_metrics WHERE bucket = ? AND bucket_start < ? ORDER BY org_id, kind, bucket_start',
    [from, cutoff]);
  if (!rows.length) return 0;
  const sums = new Map(); // "org|kind|start" → n
  for (const r of rows) {
    const ms = parseSqlTimeMs(r.bucket_start);
    if (!Number.isFinite(ms)) continue;
    const key = `${r.org_id}|${r.kind}|${startOf(ms)}`;
    sums.set(key, (sums.get(key) || 0) + Number(r.n || 0));
  }
  await db.transaction(async (tx) => {
    for (const [key, n] of sums) {
      const [org, kind, start] = key.split('|');
      await addTo(tx, Number(org), kind, to, start, n);
    }
    await tx.runAsync('DELETE FROM org_metrics WHERE bucket = ? AND bucket_start < ?', [from, cutoff]);
  });
  return rows.length;
}

/** hours → days (after 7 days), days → weeks (after 28 days), purge after 5 years. */
async function rollup(db, now = Date.now()) {
  const hours = await rollBucket(db, 'hour', 'day', now - KEEP_HOURS_MS, dayStart);
  const days = await rollBucket(db, 'day', 'week', now - KEEP_DAYS_MS, weekStart);
  const purged = await db.runAsync('DELETE FROM org_metrics WHERE bucket_start < ?', [sqlTime(now - KEEP_ALL_MS)]);
  return { hours, days, purged: purged.changes || 0 };
}

// ── reading ──────────────────────────────────────────────────────────────
const zeroKinds = () => Object.fromEntries(KINDS.map(k => [k, 0]));

/** { kind: total } over every bucket starting at or after sinceMs. */
async function totals(db, orgId, sinceMs) {
  const rows = await db.allAsync(
    'SELECT kind, SUM(n) AS n FROM org_metrics WHERE org_id = ? AND bucket_start >= ? GROUP BY kind',
    [orgId, sqlTime(sinceMs)]);
  const out = zeroKinds();
  for (const r of rows) if (KINDS.includes(r.kind)) out[r.kind] = Number(r.n || 0);
  return out;
}

/** Last `days` days, oldest first, every day present: [{ day, search, view, clicks }]. */
async function daily(db, orgId, days = 30, now = Date.now()) {
  const first = Math.floor(now / DAY) * DAY - (days - 1) * DAY;
  const rows = await db.allAsync(
    "SELECT kind, bucket_start, n FROM org_metrics WHERE org_id = ? AND bucket IN ('hour', 'day') AND bucket_start >= ?",
    [orgId, sqlTime(first)]);
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = dayStart(first + i * DAY).slice(0, 10);
    byDay.set(d, { day: d, search: 0, view: 0, clicks: 0 });
  }
  for (const r of rows) {
    const ms = parseSqlTimeMs(r.bucket_start);
    if (!Number.isFinite(ms)) continue;
    const slot = byDay.get(dayStart(ms).slice(0, 10));
    if (!slot) continue;
    const n = Number(r.n || 0);
    if (r.kind === 'search') slot.search += n;
    else if (r.kind === 'view') slot.view += n;
    else if (LINK_KINDS.includes(r.kind)) slot.clicks += n;
  }
  return [...byDay.values()];
}

/** The portal / console summary for one org. */
async function summary(db, orgId, now = Date.now()) {
  const [t7, t30, t365, series, first] = await Promise.all([
    totals(db, orgId, now - 7 * DAY),
    totals(db, orgId, now - 30 * DAY),
    totals(db, orgId, now - 365 * DAY),
    daily(db, orgId, 30, now),
    db.getAsync('SELECT MIN(bucket_start) AS s FROM org_metrics WHERE org_id = ?', [orgId])
  ]);
  // Include what is still in memory for the current hour so the numbers a
  // nonprofit sees never lag the whole hour behind.
  let sinceDay = first && first.s ? String(first.s).slice(0, 10) : null;
  for (const [key, n] of pending) {
    const [org, kind] = key.split('|');
    if (Number(org) !== orgId) continue;
    if (!sinceDay) sinceDay = dayStart(now).slice(0, 10); // first events, not flushed yet
    t7[kind] += n; t30[kind] += n; t365[kind] += n;
    const slot = series[series.length - 1];
    if (slot) { if (kind === 'search') slot.search += n; else if (kind === 'view') slot.view += n; else slot.clicks += n; }
  }
  return {
    kinds: KINDS,
    totals: { '7d': t7, '30d': t30, '365d': t365 },
    daily: series,
    since: sinceDay
  };
}

module.exports = { KINDS, LINK_KINDS, BEACON_KINDS, bump, flush, rollup, totals, daily, summary, hourStart, dayStart, weekStart, _pending: pending };
