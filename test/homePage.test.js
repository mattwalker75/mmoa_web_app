// test/homePage.test.js — run with `npm test` (node's built-in runner).
// GET /api/home: the home page's events (≤ 3) and raffle (≤ 1), with the
// optional "show on the home page from / until" dates (home_starts_at /
// home_ends_at on events and raffles). Both empty = the old rule (upcoming
// events, first current raffle); set = the window decides. /api/events and
// /api/raffles must list exactly as before. Also: an older database without
// the columns works before and after the boot migration adds them.
// Runs routes/public.js on a throwaway SQLite file with the real schema.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3');

const { init, COLUMN_MIGRATIONS, schemaStatements } = require('../db/database');
const { sqlTime } = require('../helpers/sqlTime');
const publicRoutes = require('../routes/public');

const REPO = path.join(__dirname, '..');
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const at = (msFromNow) => sqlTime(Date.now() + msFromNow);
const HOME_COLS = ['home_starts_at', 'home_ends_at'];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmoa-home-'));
const relToRepo = (f) => path.relative(REPO, f);

// Serve routes/public.js for `db` on a random local port → { base, close }.
async function serve(db) {
  const app = express();
  app.use('/api', publicRoutes(db, {}));
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  return {
    base: `http://127.0.0.1:${server.address().port}/api`,
    close: () => new Promise((res) => { server.closeAllConnections(); server.close(() => res()); })
  };
}
async function getJson(base, p) {
  const r = await fetch(base + p);
  assert.equal(r.status, 200, `${p} → ${r.status}`);
  return r.json();
}

// ── Main fixture: a fresh database (setup_sqlite_db.sql → has the columns) ──
const db = init({ database: { engine: 'sqlite', sqlite: { filename: relToRepo(path.join(tmpDir, 'home.db')) } } });
let srv;

test.before(async () => { await db.migrated; srv = await serve(db); });
test.after(async () => {
  await srv.close();
  await new Promise((res) => db.raw.close(() => res()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let seq = 0;
async function addEvent(o) {
  const slug = o.slug || `ev-${++seq}`;
  await db.runAsync(`INSERT INTO events (slug, title, starts_at, status, is_published, home_starts_at, home_ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [slug, o.title || slug, at(o.starts), o.status || 'published', (o.status || 'published') === 'published' ? 1 : 0,
    o.from == null ? null : at(o.from), o.until == null ? null : at(o.until)]);
  return slug;
}
async function addRaffle(o) {
  const slug = o.slug || `rf-${++seq}`;
  await db.runAsync(`INSERT INTO raffles (slug, title, status, visibility, is_published, drawing_at, winning_ticket, home_starts_at, home_ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [slug, o.title || slug, o.stage || 'open', o.visibility || 'published', (o.visibility || 'published') === 'published' ? 1 : 0,
    o.drawing == null ? null : at(o.drawing), o.winning || null,
    o.from == null ? null : at(o.from), o.until == null ? null : at(o.until)]);
  return slug;
}
async function reset() {
  await db.runAsync('DELETE FROM events');
  await db.runAsync('DELETE FROM raffles');
}
const slugs = (list) => list.map(x => x.slug);

// ── The rule itself ─────────────────────────────────────────────────────
test('onHomePage: no dates → the usual rule; dates → the window (inclusive, either side open)', () => {
  const { onHomePage, homeWindow } = publicRoutes;
  const now = Date.parse('2026-12-01T12:00:00Z');
  assert.equal(homeWindow({}), null, 'columns missing (old database)');
  assert.equal(homeWindow({ home_starts_at: null, home_ends_at: null }), null);
  assert.equal(homeWindow({ home_starts_at: '', home_ends_at: '' }), null, 'empty strings count as empty');
  assert.equal(onHomePage({}, now, true), true);
  assert.equal(onHomePage({}, now, false), false);
  const w = (from, until) => ({ home_starts_at: from, home_ends_at: until });
  assert.equal(onHomePage(w('2026-11-30 00:00:00', '2026-12-02 00:00:00'), now, false), true, 'inside');
  assert.equal(onHomePage(w('2026-12-01 12:00:00', '2026-12-01 12:00:00'), now, false), true, 'both ends inclusive');
  assert.equal(onHomePage(w('2026-12-01 12:00:01', null), now, true), false, 'not yet');
  assert.equal(onHomePage(w(null, '2026-12-01 11:59:59'), now, true), false, 'over');
  assert.equal(onHomePage(w('2026-11-01 00:00:00', null), now, false), true, 'from only = open-ended');
  assert.equal(onHomePage(w(null, '2027-01-01 00:00:00'), now, false), true, 'until only = shown until then');
  assert.equal(onHomePage(w(new Date(now - 1000), new Date(now + 1000)), now, false), true, 'MySQL Date objects');
});

// ── Both empty = exactly today's behaviour ──────────────────────────────
test('no home dates anywhere: /api/home = the first 3 upcoming events + the first current raffle', async () => {
  await reset();
  for (const h of [72, 5, 200, -2, 30]) await addEvent({ starts: h * HOUR }); // -2 h is still "upcoming" (12 h grace)
  await addEvent({ starts: -3 * DAY });                      // past
  await addEvent({ starts: 2 * DAY, status: 'draft' });      // not public
  await addRaffle({ stage: 'closed', drawing: 2 * DAY });
  await addRaffle({ stage: 'open', drawing: 20 * DAY });
  const soonestOpen = await addRaffle({ stage: 'open', drawing: 10 * DAY });
  await addRaffle({ stage: 'drawn', drawing: -DAY, winning: '123' });
  await addRaffle({ stage: 'open', drawing: DAY, visibility: 'draft' });

  const home = await getJson(srv.base, '/home');
  const upcoming = await getJson(srv.base, '/events?when=upcoming');
  const current = await getJson(srv.base, '/raffles?status=current');
  assert.deepEqual(home.events, upcoming.events.slice(0, 3));
  assert.equal(home.events.length, 3);
  assert.deepEqual(home.raffle, current.raffles[0]);
  assert.equal(home.raffle.slug, soonestOpen, 'open before closed, soonest drawing first');
});

test('no raffle open or closed (and no dates): no home raffle', async () => {
  await reset();
  await addRaffle({ stage: 'drawn', drawing: -DAY, winning: '7' });
  const home = await getJson(srv.base, '/home');
  assert.equal(home.raffle, null);
  assert.deepEqual(home.events, []);
});

// ── Dates decide ────────────────────────────────────────────────────────
test('events with dates: shown inside the window even after the start, hidden outside it even if upcoming', async () => {
  await reset();
  const started = await addEvent({ starts: -3 * DAY, from: -5 * DAY, until: DAY });   // past, window now → shown
  const early = await addEvent({ starts: 40 * DAY, from: -DAY, until: 41 * DAY });    // far off, window now → shown
  const notYet = await addEvent({ starts: 5 * DAY, from: DAY, until: 6 * DAY });      // upcoming, window later → hidden
  const over = await addEvent({ starts: 5 * DAY, from: -10 * DAY, until: -HOUR });    // upcoming, window over → hidden
  const fromOnly = await addEvent({ starts: -10 * DAY, from: -11 * DAY });            // open-ended → shown
  await addEvent({ starts: 2 * DAY, status: 'draft', from: -DAY, until: DAY });       // draft → never
  await addEvent({ starts: 3 * DAY, status: 'archived', from: -DAY, until: DAY });    // archived → never

  const home = await getJson(srv.base, '/home');
  assert.deepEqual(slugs(home.events), [fromOnly, started, early], 'soonest starts_at first');
  assert.ok(!slugs(home.events).includes(notYet));
  assert.ok(!slugs(home.events).includes(over));
  // The item shape is the list's (nothing new added to it).
  const listed = (await getJson(srv.base, '/events?when=past')).events.find(e => e.slug === started);
  assert.deepEqual(home.events.find(e => e.slug === started), listed);
  for (const e of home.events) for (const c of HOME_COLS) assert.ok(!(c in e));
});

test('dated and undated events mix: undated ones keep the usual rule; at most 3, soonest start first', async () => {
  await reset();
  const a = await addEvent({ starts: 3 * DAY });                          // usual: upcoming → in
  const b = await addEvent({ starts: -4 * DAY, from: -5 * DAY });         // dated, in window
  const c = await addEvent({ starts: 2 * DAY, from: 3 * DAY });           // dated, not yet → out
  const d = await addEvent({ starts: DAY });                              // usual → in
  const e = await addEvent({ starts: 9 * DAY, until: 30 * DAY });         // dated, until only → in
  const f = await addEvent({ starts: 20 * DAY });                         // usual → 5th, cut by the limit
  const home = await getJson(srv.base, '/home');
  assert.deepEqual(slugs(home.events), [b, d, a]);
  assert.ok(![c, e, f].some(s => slugs(home.events).includes(s)));
  // Without the limit, e would be 4th:
  await db.runAsync('DELETE FROM events WHERE slug IN (?, ?)', [a, d]);
  assert.deepEqual(slugs((await getJson(srv.base, '/home')).events), [b, e, f]);
});

test('raffles with dates: shown in any stage inside the window, hidden outside it; one only', async () => {
  await reset();
  const drawn = await addRaffle({ stage: 'drawn', drawing: -2 * DAY, winning: 'A-17', from: -10 * DAY, until: 3 * DAY });
  const openLater = await addRaffle({ stage: 'open', drawing: 30 * DAY, from: 2 * DAY });  // before ticket sales → hidden for now
  let home = await getJson(srv.base, '/home');
  assert.equal(home.raffle.slug, drawn, 'a drawn raffle inside its window shows');
  assert.equal(home.raffle.status, 'drawn');
  assert.equal(home.raffle.winning_ticket, 'A-17');

  // An undated closed raffle (usual rule) now qualifies too: closed beats drawn.
  const closed = await addRaffle({ stage: 'closed', drawing: 5 * DAY });
  home = await getJson(srv.base, '/home');
  assert.equal(home.raffle.slug, closed);

  // An open raffle in its window (before its drawing, any distance) beats both.
  const open = await addRaffle({ stage: 'open', drawing: 60 * DAY, from: -HOUR, until: 61 * DAY });
  home = await getJson(srv.base, '/home');
  assert.equal(home.raffle.slug, open);
  assert.notEqual(home.raffle.slug, openLater);

  // Its window over → back to the closed one; a published-but-dated draft never shows.
  await db.runAsync('UPDATE raffles SET home_ends_at = ? WHERE slug = ?', [at(-1000), open]);
  await addRaffle({ stage: 'open', drawing: DAY, visibility: 'draft', from: -DAY, until: DAY });
  home = await getJson(srv.base, '/home');
  assert.equal(home.raffle.slug, closed);
});

test('several drawn raffles in their windows: the most recent drawing first', async () => {
  await reset();
  await addRaffle({ stage: 'drawn', drawing: -9 * DAY, winning: '1', from: -20 * DAY });
  const recent = await addRaffle({ stage: 'drawn', drawing: -DAY, winning: '2', from: -20 * DAY });
  await addRaffle({ stage: 'drawn', winning: '3', from: -20 * DAY }); // undated → last
  assert.equal((await getJson(srv.base, '/home')).raffle.slug, recent);
});

// ── The /events and /raffles pages are unchanged ────────────────────────
test('/api/events and /api/raffles ignore the home dates', async () => {
  await reset();
  const notYet = await addEvent({ starts: 5 * DAY, from: DAY });               // hidden on home…
  const started = await addEvent({ starts: -3 * DAY, from: -5 * DAY });       // …shown on home
  const plain = await addEvent({ starts: 2 * DAY });
  const openLater = await addRaffle({ stage: 'open', drawing: 9 * DAY, from: 2 * DAY });
  const drawn = await addRaffle({ stage: 'drawn', drawing: -DAY, winning: '9', from: -DAY });

  assert.deepEqual(slugs((await getJson(srv.base, '/events?when=upcoming')).events), [plain, notYet]);
  assert.deepEqual(slugs((await getJson(srv.base, '/events?when=past')).events), [started]);
  assert.deepEqual(slugs((await getJson(srv.base, '/raffles?status=current')).raffles), [openLater]);
  assert.deepEqual(slugs((await getJson(srv.base, '/raffles?status=past')).raffles), [drawn]);
  assert.equal((await getJson(srv.base, '/events/' + notYet)).event.slug, notYet);
  const all = [...(await getJson(srv.base, '/events?when=upcoming')).events, ...(await getJson(srv.base, '/raffles?status=current')).raffles];
  for (const x of all) for (const c of HOME_COLS) assert.ok(!(c in x), `${c} is not sent`);

  const home = await getJson(srv.base, '/home');
  assert.deepEqual(slugs(home.events), [started, plain]);
  assert.equal(home.raffle.slug, drawn);
});

// ── Schema: both setup files + the boot migration ───────────────────────
for (const engine of ['sqlite', 'mysql']) {
  test(`${engine}: events and raffles have home_starts_at / home_ends_at in setup_${engine}_db.sql`, () => {
    const { creates } = schemaStatements(engine);
    for (const table of ['events', 'raffles']) {
      const ddl = creates[table].find(s => /^CREATE TABLE/i.test(s));
      for (const c of HOME_COLS) {
        assert.match(ddl, new RegExp(`\\b${c}\\s+TIMESTAMP${engine === 'mysql' ? ' NULL' : ''}\\b`, 'i'), `${table}.${c}`);
      }
    }
  });
}

test('the boot migration adds the four columns as nullable TIMESTAMPs', () => {
  for (const table of ['events', 'raffles']) {
    for (const c of HOME_COLS) {
      assert.ok(COLUMN_MIGRATIONS.some(([t, col, type]) => t === table && col === c && type === 'TIMESTAMP NULL'), `${table}.${c}`);
    }
  }
});

// ── An older database (no home columns) ─────────────────────────────────
test('an older database works before the upgrade, and the boot migration then adds the columns', async () => {
  const file = path.join(tmpDir, 'old.db');
  // The schema as it was before: setup_sqlite_db.sql without the two lines.
  const oldDdl = fs.readFileSync(path.join(REPO, 'setup_sqlite_db.sql'), 'utf8')
    .split('\n').filter(l => !/\bhome_(starts|ends)_at\b/.test(l)).join('\n');
  const raw = new sqlite3.Database(file);
  const exec = (sql) => new Promise((res, rej) => raw.exec(sql, (e) => e ? rej(e) : res()));
  await exec(oldDdl);
  await exec(`INSERT INTO events (slug, title, starts_at, status, is_published) VALUES
      ('soon', 'Soon', '${at(DAY)}', 'published', 1), ('gone', 'Gone', '${at(-3 * DAY)}', 'published', 1);
    INSERT INTO raffles (slug, title, status, visibility, is_published, drawing_at) VALUES
      ('r-open', 'Open', 'open', 'published', 1, '${at(9 * DAY)}');`);
  const colsOf = (table) => new Promise((res, rej) => raw.all(`PRAGMA table_info(${table})`, (e, rows) => e ? rej(e) : res(rows.map(r => r.name))));
  assert.ok(!(await colsOf('events')).includes('home_starts_at'), 'really an old schema');

  // Before the upgrade ran (e.g. the site answering while the migration is
  // still pending, or a MySQL user that may not ALTER): the usual rule.
  const adapter = {
    engine: 'sqlite',
    allAsync: (sql, p) => new Promise((res, rej) => raw.all(sql, p || [], (e, rows) => e ? rej(e) : res(rows))),
    getAsync: (sql, p) => new Promise((res, rej) => raw.get(sql, p || [], (e, row) => e ? rej(e) : res(row)))
  };
  const before = await serve(adapter);
  try {
    const home = await getJson(before.base, '/home');
    assert.deepEqual(slugs(home.events), ['soon']);
    assert.equal(home.raffle.slug, 'r-open');
    assert.deepEqual(slugs((await getJson(before.base, '/events?when=past')).events), ['gone']);
  } finally { await before.close(); }
  await new Promise((res) => raw.close(() => res()));

  // The app's next start: the boot migration adds the columns, data intact.
  const upgraded = init({ database: { engine: 'sqlite', sqlite: { filename: relToRepo(file) } } });
  await upgraded.migrated;
  for (const table of ['events', 'raffles']) {
    const cols = (await upgraded.allAsync(`PRAGMA table_info(${table})`)).map(r => r.name);
    for (const c of HOME_COLS) assert.ok(cols.includes(c), `${table}.${c} added`);
  }
  const after = await serve(upgraded);
  try {
    let home = await getJson(after.base, '/home');
    assert.deepEqual(slugs(home.events), ['soon'], 'still the usual rule while the dates are empty');
    await upgraded.runAsync("UPDATE events SET home_starts_at = ?, home_ends_at = ? WHERE slug = 'gone'", [at(-5 * DAY), at(DAY)]);
    await upgraded.runAsync("UPDATE raffles SET home_starts_at = ? WHERE slug = 'r-open'", [at(DAY)]);
    home = await getJson(after.base, '/home');
    assert.deepEqual(slugs(home.events), ['gone', 'soon'], 'the dates now decide');
    assert.equal(home.raffle, null, 'the raffle waits for its window');
  } finally { await after.close(); }
  await new Promise((res) => upgraded.raw.close(() => res()));

  // Booting again is a no-op (idempotent).
  const again = init({ database: { engine: 'sqlite', sqlite: { filename: relToRepo(file) } } });
  await again.migrated;
  const row = await again.getAsync("SELECT home_starts_at FROM events WHERE slug = 'gone'");
  assert.ok(row && row.home_starts_at, 'the value set after the upgrade is kept');
  await new Promise((res) => again.raw.close(() => res()));
});
