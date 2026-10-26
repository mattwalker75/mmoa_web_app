// test/orgMetrics.test.js — counting, hourly flush, the hour→day→week
// rollup, the 5-year purge and the summary shape (helpers/orgMetrics.js),
// against a throwaway SQLite file with the real schema.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { init } = require('../db/database');
const m = require('../helpers/orgMetrics');
const { sqlTime } = require('../helpers/sqlTime');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmoa-metrics-'));
const dbFile = path.join(tmpDir, 'm.db');
const db = init({ database: { engine: 'sqlite', sqlite: { filename: path.relative(path.join(__dirname, '..'), dbFile) } } });

const DAY = 86400 * 1000;
const count = async (bucket) => (await db.getAsync('SELECT COUNT(*) AS c, COALESCE(SUM(n), 0) AS n FROM org_metrics WHERE bucket = ?', [bucket]));

test.before(async () => { await db.migrated; });
test.after(async () => {
  await new Promise((res) => db.raw.close(() => res()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('bump accepts only known kinds and positive org ids', () => {
  assert.equal(m.bump(1, 'call'), true);
  assert.equal(m.bump(1, 'nope'), false);
  assert.equal(m.bump(0, 'call'), false);
  assert.equal(m.bump('1', 'call'), false);
  m._pending.clear();
});

test('flush writes hour buckets and adds to an existing row', async () => {
  m.bump(7, 'view'); m.bump(7, 'view'); m.bump(7, 'call');
  assert.equal(await m.flush(db), 2);
  m.bump(7, 'view');
  assert.equal(await m.flush(db), 1);
  const rows = await db.allAsync('SELECT kind, n FROM org_metrics WHERE org_id = 7 ORDER BY kind');
  assert.deepEqual(rows.map(r => [r.kind, Number(r.n)]), [['call', 1], ['view', 3]]);
  assert.equal(m._pending.size, 0);
});

test('rollup: hours older than 7 days become day rows, days older than 35 become week rows, 5+ years is purged', async () => {
  await db.runAsync('DELETE FROM org_metrics');
  const now = Date.UTC(2026, 9, 23, 15, 0, 0); // Fri 2026-10-23 15:00 UTC
  const ins = (bucket, start, n, kind = 'view') =>
    db.runAsync('INSERT INTO org_metrics (org_id, kind, bucket, bucket_start, n) VALUES (3, ?, ?, ?, ?)', [kind, bucket, sqlTime(start), n]);
  // two hours on the same old day (10 days ago) + one fresh hour
  await ins('hour', now - 10 * DAY, 2);
  await ins('hour', now - 10 * DAY + 3600 * 1000, 5);
  await ins('hour', now - 3600 * 1000, 1);
  // two days in the same old week (40 days ago, Mon+Tue) + one recent day
  const mon = Date.UTC(2026, 8, 7); // Monday 2026-09-07
  await ins('day', mon, 4, 'call');
  await ins('day', mon + DAY, 6, 'call');
  await ins('day', Math.floor((now - 10 * DAY) / DAY) * DAY, 9, 'call');
  // ancient
  await ins('week', now - 6 * 365 * DAY, 100);

  const r = await m.rollup(db, now);
  assert.deepEqual(r, { hours: 2, days: 2, purged: 1 });
  assert.deepEqual(await count('hour'), { c: 1, n: 1 });
  const days = await db.allAsync("SELECT kind, bucket_start, n FROM org_metrics WHERE bucket = 'day' ORDER BY kind");
  assert.deepEqual(days.map(d => [d.kind, d.bucket_start, Number(d.n)]), [
    ['call', '2026-10-13 00:00:00', 9],   // the recent day row, untouched
    ['view', '2026-10-13 00:00:00', 7]    // 2 + 5 from the two old hours
  ]);
  const weeks = await db.allAsync("SELECT kind, bucket_start, n FROM org_metrics WHERE bucket = 'week'");
  assert.deepEqual(weeks.map(w => [w.kind, w.bucket_start, Number(w.n)]), [['call', '2026-09-07 00:00:00', 10]]);
  // idempotent: a second run moves nothing
  assert.deepEqual(await m.rollup(db, now), { hours: 0, days: 0, purged: 0 });
});

test('weekStart is a Monday 00:00 UTC', () => {
  assert.equal(m.weekStart(Date.UTC(2026, 9, 23, 15)), '2026-10-19 00:00:00'); // Fri → Mon
  assert.equal(m.weekStart(Date.UTC(2026, 9, 19, 0)), '2026-10-19 00:00:00');  // Mon stays
  assert.equal(m.weekStart(Date.UTC(2026, 9, 18, 23)), '2026-10-12 00:00:00'); // Sun → previous Mon
});

test('summary: totals per window, 30 filled days, pending counts included, since', async () => {
  await db.runAsync('DELETE FROM org_metrics');
  const now = Date.UTC(2026, 9, 23, 15, 0, 0);
  const ins = (bucket, start, n, kind) =>
    db.runAsync('INSERT INTO org_metrics (org_id, kind, bucket, bucket_start, n) VALUES (5, ?, ?, ?, ?)', [kind, bucket, sqlTime(start), n]);
  await ins('hour', now - 2 * 3600 * 1000, 3, 'search');
  await ins('day', now - 20 * DAY, 2, 'website');
  await ins('week', now - 100 * DAY, 8, 'view');
  m.bump(5, 'call');
  const s = await m.summary(db, 5, now);
  assert.deepEqual(s.kinds, m.KINDS);
  assert.equal(s.totals['7d'].search, 3);
  assert.equal(s.totals['7d'].website, 0);
  assert.equal(s.totals['30d'].website, 2);
  assert.equal(s.totals['365d'].view, 8);
  assert.equal(s.totals['7d'].call, 1, 'in-memory count shows immediately');
  assert.equal(s.daily.length, 30);
  assert.equal(s.daily[29].day, '2026-10-23');
  assert.equal(s.daily[29].search, 3);
  assert.equal(s.daily[29].clicks, 1);
  assert.equal(s.daily[9].clicks, 2, '20 days ago has the website click');
  assert.equal(s.since, sqlTime(now - 100 * DAY).slice(0, 10));
  m._pending.clear();
  const empty = await m.summary(db, 999, now);
  assert.equal(empty.since, null);
  m.bump(999, 'view');
  assert.equal((await m.summary(db, 999, now)).since, '2026-10-23', 'unflushed first events still count as a start day');
  m._pending.clear();
});

test('rollup keeps day rows for the whole 30-day chart window', async () => {
  await db.runAsync('DELETE FROM org_metrics');
  const now = Date.UTC(2026, 9, 23, 15, 0, 0);
  const day29 = Math.floor(now / DAY) * DAY - 29 * DAY; // the chart's oldest day
  await db.runAsync("INSERT INTO org_metrics (org_id, kind, bucket, bucket_start, n) VALUES (6, 'view', 'day', ?, 4)", [sqlTime(day29)]);
  await m.rollup(db, now);
  const s = await m.summary(db, 6, now);
  assert.equal(s.daily[0].view, 4, 'oldest chart day still shows its count after a rollup');
  assert.equal(s.totals['30d'].view, 4);
});

test('a failed flush keeps every count that was not written', async () => {
  m._pending.clear();
  m.bump(11, 'view'); m.bump(12, 'view'); m.bump(13, 'view');
  // every write for org 12 fails (the DB stays busy for that row)
  const flaky = {
    getAsync: (...a) => db.getAsync(...a),
    allAsync: (...a) => db.allAsync(...a),
    runAsync: async (sql, params) => { if ((params || []).includes(12)) throw new Error('SQLITE_BUSY'); return db.runAsync(sql, params); }
  };
  await assert.rejects(m.flush(flaky), /SQLITE_BUSY/);
  const left = [...m._pending.keys()].map(k => k.split('|')[0]).sort();
  assert.deepEqual(left, ['12', '13'], 'the failing entry and every one after it are kept');
  assert.equal(await m.flush(db) >= 2, true);
  assert.equal(m._pending.size, 0);
  m._pending.clear();
});
