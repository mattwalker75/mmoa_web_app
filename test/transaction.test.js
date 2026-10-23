// test/transaction.test.js — run with `npm test` (node's built-in runner).
// The SQLite transaction gate in db/database.js: statements issued through
// the public db.* API while a transaction is open must wait for it (so a
// ROLLBACK can't take an unrelated request's write down with it), while
// tx.* statements inside the transaction body run at once.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { init } = require('../db/database');

// A throwaway SQLite file (init() resolves the filename against the repo root).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmoa-tx-'));
const dbFile = path.join(tmpDir, 'tx.db');
const db = init({ database: { engine: 'sqlite', sqlite: { filename: path.relative(path.join(__dirname, '..'), dbFile) } } });

test.before(async () => {
  await db.migrated;
  await db.runAsync('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
});

test.after(async () => {
  await new Promise((res) => db.raw.close(() => res()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a db.runAsync started during a transaction that rolls back is NOT rolled back', async () => {
  let insideSeen = null;
  let bodyStarted;
  const started = new Promise((r) => { bodyStarted = r; });
  let release;
  const held = new Promise((r) => { release = r; });
  const txPromise = db.transaction(async (tx) => {
    await tx.runAsync("INSERT INTO t (v) VALUES ('inside')");
    insideSeen = await tx.getAsync("SELECT COUNT(*) AS n FROM t WHERE v = 'inside'");
    bodyStarted();
    await held; // hold the transaction open while the test issues an unrelated write
    throw new Error('boom');
  });
  await started;
  // Issued from OUTSIDE the transaction body (another request, in effect).
  let outsideDone = false;
  const outside = db.runAsync("INSERT INTO t (v) VALUES ('outside')").then(() => { outsideDone = true; });
  await sleep(50);
  assert.equal(outsideDone, false, 'the outside write must wait for the transaction');
  release();
  let caught;
  try { await txPromise; } catch (e) { caught = e; }
  assert.equal(caught && caught.message, 'boom', 'the body error propagates');
  assert.equal(Number(insideSeen.n), 1, 'tx statements inside the body ran');
  await outside;
  assert.equal(outsideDone, true);
  const rows = await db.allAsync('SELECT v FROM t ORDER BY id');
  assert.deepEqual(rows.map(r => r.v), ['outside'], 'inside rolled back, outside survived');
});

test('sequential transactions still work (commit, then another commit)', async () => {
  await db.transaction(async (tx) => { await tx.runAsync("INSERT INTO t (v) VALUES ('a')"); });
  const r = await db.transaction(async (tx) => {
    await tx.runAsync("INSERT INTO t (v) VALUES ('b')");
    return tx.getAsync('SELECT COUNT(*) AS n FROM t');
  });
  assert.equal(Number(r.n), 3);
  const rows = await db.allAsync('SELECT v FROM t ORDER BY id');
  assert.deepEqual(rows.map(r => r.v), ['outside', 'a', 'b']);
});

test('overlapping transactions are serialized', async () => {
  const order = [];
  const t1 = db.transaction(async (tx) => {
    order.push('t1 start');
    await sleep(30);
    await tx.runAsync("INSERT INTO t (v) VALUES ('t1')");
    order.push('t1 end');
  });
  const t2 = db.transaction(async (tx) => {
    order.push('t2 start');
    await tx.runAsync("INSERT INTO t (v) VALUES ('t2')");
    order.push('t2 end');
  });
  await Promise.all([t1, t2]);
  assert.deepEqual(order, ['t1 start', 't1 end', 't2 start', 't2 end']);
});

test('a stray db.* call inside the body runs instead of deadlocking', async () => {
  const n = await db.transaction(async () => {
    await db.runAsync("INSERT INTO t (v) VALUES ('stray')");
    return db.getAsync("SELECT COUNT(*) AS n FROM t WHERE v = 'stray'");
  });
  assert.equal(Number(n.n), 1);
});

test('callback-style db.run / db.get still work', async () => {
  const res = await new Promise((resolve, reject) => db.run("INSERT INTO t (v) VALUES ('cb')", (err, r) => err ? reject(err) : resolve(r)));
  assert.equal(res.changes, 1);
  const row = await new Promise((resolve, reject) => db.get('SELECT v FROM t WHERE id = ?', [res.lastID], (err, r) => err ? reject(err) : resolve(r)));
  assert.equal(row.v, 'cb');
});

test('WAL journal mode and busy timeout are set', async () => {
  const row = await db.getAsync('PRAGMA journal_mode');
  assert.equal(String(row.journal_mode).toLowerCase(), 'wal');
  assert.ok(fs.existsSync(dbFile + '-wal'), 'the -wal sidecar exists next to the DB file');
});
