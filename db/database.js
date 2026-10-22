// db/database.js — dual-engine MySQL/SQLite abstraction.
//
// Mirrors the pattern used in car_show_control_plane: callers use db.get /
// db.all / db.run with callbacks, OR the *Async variants for await-style code.
// The underlying engine is chosen from config.database.engine.
//
//   db.engine                 — 'sqlite' or 'mysql' (read-only string)
//   db.get(sql, params, cb)   — single row (cb(err, row))
//   db.all(sql, params, cb)   — many rows
//   db.run(sql, params, cb)   — INSERT / UPDATE / DELETE (cb(err, { lastID, changes }))
//   db.getAsync / allAsync / runAsync — Promise wrappers
//   db.transaction(fn)        — runs fn(tx) where tx has the same methods, in a tx
//
// Why this shape: the admin console (mmoa_admin_console) talks to this same
// database through the same surface, so query code can move between the two
// repos without rewriting.

const fs = require('fs');
const path = require('path');

function initSqlite(cfg) {
  const sqlite3 = require('sqlite3');
  const dbFile = path.join(__dirname, '..', cfg.filename || 'mmoa_web_app.db');

  // If the file doesn't exist yet, create it from the schema SQL so a fresh
  // clone of the repo can `npm install && ./START_APP.sh` with no manual step.
  const isFresh = !fs.existsSync(dbFile);
  const sqliteDb = new sqlite3.Database(dbFile);

  // FK enforcement is OFF by default in SQLite — turn it on so the CASCADEs
  // in the schema actually fire.
  sqliteDb.run('PRAGMA foreign_keys = ON');

  // `ready` resolves once a fresh file's bootstrap DDL has finished, so the
  // boot-time migrations below never race it (they await db.ready).
  let ready = Promise.resolve();
  if (isFresh) {
    const schemaPath = path.join(__dirname, '..', 'setup_sqlite_db.sql');
    if (fs.existsSync(schemaPath)) {
      const ddl = fs.readFileSync(schemaPath, 'utf8');
      ready = new Promise((resolve) => {
        sqliteDb.exec(ddl, (err) => {
          if (err) console.error('[db] SQLite schema bootstrap failed:', err.message);
          else console.log(`[db] Initialized fresh SQLite database at ${dbFile}`);
          resolve();
        });
      });
    } else {
      console.warn(`[db] No setup_sqlite_db.sql found — DB is empty.`);
    }
  }

  return {
    engine: 'sqlite',
    raw: sqliteDb,
    ready,

    get(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      sqliteDb.get(sql, params, cb);
    },
    all(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      sqliteDb.all(sql, params, cb);
    },
    run(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      sqliteDb.run(sql, params, function (err) {
        if (cb) cb(err, err ? null : { lastID: this.lastID, changes: this.changes });
      });
    },

    getAsync(sql, params) {
      return new Promise((resolve, reject) => {
        sqliteDb.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row));
      });
    },
    allAsync(sql, params) {
      return new Promise((resolve, reject) => {
        sqliteDb.all(sql, params || [], (err, rows) => err ? reject(err) : resolve(rows));
      });
    },
    runAsync(sql, params) {
      return new Promise((resolve, reject) => {
        sqliteDb.run(sql, params || [], function (err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },

    // Transaction wrapper. SQLite uses ONE shared connection, so BEGIN/COMMIT
    // are process-wide — two overlapping transactions would interleave on the
    // same connection (a nested BEGIN errors, or one tx's writes land inside
    // another's BEGIN/COMMIT). Serialize transactions through an in-process
    // queue so each runs to completion before the next starts.
    async transaction(fn) {
      const tx = this;
      const run = async () => {
        await tx.runAsync('BEGIN');
        try {
          const result = await fn(tx);
          await tx.runAsync('COMMIT');
          return result;
        } catch (err) {
          try { await tx.runAsync('ROLLBACK'); } catch (e) { /* ignore */ }
          throw err;
        }
      };
      const prev = tx._txChain || Promise.resolve();
      let release;
      tx._txChain = new Promise((res) => { release = res; });
      try {
        await prev.catch(() => {}); // wait for the prior tx; don't inherit its rejection
        return await run();
      } finally {
        release();
      }
    }
  };
}

function initMysql(cfg) {
  const mysql = require('mysql2');

  const pool = mysql.createPool({
    host: cfg.host || 'localhost',
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit || 10,
    waitForConnections: cfg.waitForConnections !== false,
    queueLimit: cfg.queueLimit || 100,
    multipleStatements: false,
    // The app writes JS-computed UTC timestamps ('YYYY-MM-DD HH:MM:SS' via
    // sqlTime) and compares TIMESTAMP columns against them (token expiry,
    // upcoming events). That is only correct if the session time zone is
    // UTC — the same assumption SQLite's CURRENT_TIMESTAMP already satisfies.
    // Pin it so a server running in local time can't shift every deadline by
    // its UTC offset.
    timezone: 'Z'
  });

  // timezone:'Z' above only tells the DRIVER how to convert JS Dates; the
  // server still renders TIMESTAMP columns (and evaluates CURRENT_TIMESTAMP
  // defaults like created_at) in the SESSION time zone. Pin every pooled
  // connection's session to UTC too, so a server configured for local time
  // can't skew values the driver then reads back as UTC.
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'", (err) => {
      if (err) console.warn('[db] could not set MySQL session time_zone to UTC:', err.message);
    });
  });

  function exec(sql, params, cb) {
    pool.query(sql, params || [], cb);
  }

  return {
    engine: 'mysql',
    raw: pool,
    ready: Promise.resolve(),

    get(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      exec(sql, params, (err, rows) => cb(err, rows && rows[0]));
    },
    all(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      exec(sql, params, (err, rows) => cb(err, rows || []));
    },
    run(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      exec(sql, params, (err, result) => {
        if (cb) cb(err, err ? null : { lastID: result.insertId, changes: result.affectedRows });
      });
    },

    getAsync(sql, params) {
      return new Promise((resolve, reject) => {
        exec(sql, params || [], (err, rows) => err ? reject(err) : resolve(rows && rows[0]));
      });
    },
    allAsync(sql, params) {
      return new Promise((resolve, reject) => {
        exec(sql, params || [], (err, rows) => err ? reject(err) : resolve(rows || []));
      });
    },
    runAsync(sql, params) {
      return new Promise((resolve, reject) => {
        exec(sql, params || [], (err, result) => {
          if (err) reject(err);
          else resolve({ lastID: result.insertId, changes: result.affectedRows });
        });
      });
    },

    async transaction(fn) {
      const conn = await pool.promise().getConnection();
      try {
        await conn.beginTransaction();
        const tx = {
          engine: 'mysql',
          getAsync: async (sql, params) => {
            const [rows] = await conn.query(sql, params || []);
            return rows && rows[0];
          },
          allAsync: async (sql, params) => {
            const [rows] = await conn.query(sql, params || []);
            return rows || [];
          },
          runAsync: async (sql, params) => {
            const [result] = await conn.query(sql, params || []);
            return { lastID: result.insertId, changes: result.affectedRows };
          }
        };
        const result = await fn(tx);
        await conn.commit();
        return result;
      } catch (err) {
        try { await conn.rollback(); } catch (e) { /* ignore */ }
        throw err;
      } finally {
        conn.release();
      }
    }
  };
}

// ── Additive schema migrations ────────────────────────────────────────────
// A fresh SQLite file is bootstrapped from setup_sqlite_db.sql, and a MySQL
// database from setup_mysql_db.sql — but a DB created by an OLDER version of
// those files would be missing anything added since, and queries referencing
// it would throw at runtime. So every boot applies each entry below
// idempotently on BOTH engines (a "duplicate column" / "already exists" error
// just means it's already there → ignore). `ADD COLUMN` on an existing table
// is cheap and safe.
//
// Keep these lists in sync with setup_*.sql when you add a column or table:
// add it to BOTH SQL files (so fresh installs get it) AND here (so existing
// installs pick it up). A whole NEW table only needs its name appended to
// SCHEMA_V2_TABLES below — its DDL is read from the setup files. Column e.g.
//   ['events', 'image_url', 'TEXT'],
const COLUMN_MIGRATIONS = [
  // Optional phone extensions (2026-10): digits only, shown as "ext. 123".
  ['organizations', 'phone_ext', 'VARCHAR(10)'],
  ['org_contacts', 'phone_ext', 'VARCHAR(10)'],
  // Private search keywords (2026-10): comma-separated, never shown publicly.
  ['organizations', 'search_tags', 'TEXT'],
  // Event status (2026-10): draft | published | archived (replaces the
  // is_published flag, which the console keeps in step as a mirror), and the
  // console's short-lived preview link.
  ['events', 'status', "VARCHAR(16) NOT NULL DEFAULT 'draft'"],
  ['events', 'preview_token', 'VARCHAR(64)'],
  ['events', 'preview_expires_at', 'TIMESTAMP NULL']
];

// Indexes added after a DB's first launch. CREATE … IF NOT EXISTS is
// idempotent on both engines; the DDL differs enough to keep one list per
// engine. Keep in sync with setup_*.sql.
const TABLE_MIGRATIONS = [
  // Login names are case-insensitive. MySQL's utf8mb4_unicode_ci collation
  // already makes the UNIQUE(login_name) index behave that way; SQLite's is
  // byte-wise, so it gets a second, NOCASE unique index. (Fails harmlessly
  // with a warning if an existing DB already holds 'Amy' and 'amy'.)
  { table: 'users', sqlite: ['CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_nocase ON users(login_name COLLATE NOCASE)'], mysql: [] }
];

// Whole tables added in schema v2 (events / raffles / nonprofit directory /
// board). Rather than a second hand-maintained copy of their DDL, the
// statements are read straight out of setup_sqlite_db.sql / setup_mysql_db.sql
// — so the setup files stay the single source of truth. On boot, each table
// below that is MISSING is created (with its indexes) and, only then, given
// the setup file's seed rows. A table that already exists is never touched,
// so a category the console deleted is not resurrected on the next boot.
// Order matters (foreign keys point at earlier tables).
const SCHEMA_V2_TABLES = [
  'organizations', 'org_contacts', 'org_images', 'categories', 'org_categories',
  'cities', 'org_cities', 'events', 'event_beneficiaries', 'raffles',
  'raffle_images', 'board_members'
];

// Split a setup_*.sql file into statements grouped by the table they act on:
// { creates: { table: [CREATE TABLE…, CREATE INDEX…] }, seeds: { table: [INSERT…] } }.
// Comment lines and trailing "-- …" comments are dropped first (some comments
// contain ';'). The files never put ';' inside a string literal.
function schemaStatements(engine) {
  const file = path.join(__dirname, '..', engine === 'mysql' ? 'setup_mysql_db.sql' : 'setup_sqlite_db.sql');
  const out = { creates: {}, seeds: {} };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return out; }
  const cleaned = text.split('\n')
    .filter(l => !/^\s*--/.test(l))
    .map(l => l.replace(/\s+--\s.*$/, ''))
    .join('\n');
  for (const raw of cleaned.split(';')) {
    const stmt = raw.trim();
    if (!stmt) continue;
    let m;
    if ((m = stmt.match(/^CREATE TABLE IF NOT EXISTS (\w+)/i)) ||
        (m = stmt.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+ ON (\w+)/i))) {
      (out.creates[m[1]] = out.creates[m[1]] || []).push(stmt);
    } else if ((m = stmt.match(/^INSERT (?:OR IGNORE |IGNORE )?INTO (\w+)/i))) {
      (out.seeds[m[1]] = out.seeds[m[1]] || []).push(stmt);
    }
  }
  return out;
}

async function tableColumns(db, table) {
  try {
    if (db.engine === 'mysql') {
      const rows = await db.allAsync(`SHOW COLUMNS FROM \`${table}\``);
      return rows.map(r => r.Field);
    }
    const rows = await db.allAsync(`PRAGMA table_info(${table})`);
    return rows.map(r => r.name);
  } catch (e) {
    return []; // MySQL: table doesn't exist
  }
}

async function runSchemaV2Migrations(db) {
  // The v1 `events` table (title/description/location, no slug) is REPLACED
  // in v2. It only ever held the three placeholder seed events, so on a DB
  // that still has exactly that old column set it is dropped and recreated
  // below. Any other unexpected shape is left alone (and warned about).
  const evCols = await tableColumns(db, 'events');
  if (evCols.length && !evCols.includes('slug')) {
    if (evCols.includes('location') && evCols.includes('description')) {
      console.warn('[db] migration: dropping the v1 events table (old column set; replaced by the v2 events schema)');
      await db.runAsync('DROP TABLE events');
    } else {
      console.warn('[db] migration: events table has an unexpected column set — left as is; rebuild the DB to get the v2 schema');
    }
  }

  const { creates, seeds } = schemaStatements(db.engine);
  let created = 0;
  for (const table of SCHEMA_V2_TABLES) {
    if ((await tableColumns(db, table)).length) continue; // already there
    try {
      for (const sql of (creates[table] || [])) await db.runAsync(sql);
      for (const sql of (seeds[table] || [])) await db.runAsync(sql);
      created++;
      console.log(`[db] migration: created table ${table}`);
    } catch (e) {
      // e.g. a MySQL app user with only SELECT/INSERT/UPDATE/DELETE grants —
      // run setup_mysql_db.sql as root instead.
      console.warn(`[db] migration: could not create ${table}:`, (e && e.message) || e);
    }
  }
  if (created) console.log(`[db] created ${created} schema v2 table(s)`);
}

async function runTableMigrations(db) {
  for (const m of TABLE_MIGRATIONS) {
    for (const sql of (m[db.engine] || [])) {
      try { await db.runAsync(sql); }
      catch (e) {
        const msg = (e && e.message) || '';
        if (!/already exists|no such table|doesn't exist/i.test(msg)) {
          console.warn(`[db] table migration ${m.table} skipped:`, msg);
        }
      }
    }
  }
}

// Reference rows added after a DB's first launch (a table that already
// existed never re-runs its setup seeds). INSERT-if-missing keyed on a UNIQUE
// column, so it's a no-op once present. To hide one, deactivate it in the
// console — deleting it just means it comes back on the next boot.
const ROW_MIGRATIONS = [
  { table: 'categories', sqlite: "INSERT OR IGNORE INTO categories (slug, name, sort) VALUES ('other', 'Other', 99)",
    mysql: "INSERT IGNORE INTO categories (slug, name, sort) VALUES ('other', 'Other', 99)" },
  // Events published before the status column existed (or written since by
  // something that only sets is_published) → status 'published'. The console
  // clears is_published for drafts and archived events, so this never
  // republishes one of those.
  { table: 'events', sqlite: "UPDATE events SET status = 'published' WHERE is_published = 1 AND status = 'draft'",
    mysql: "UPDATE events SET status = 'published' WHERE is_published = 1 AND status = 'draft'" }
];

async function runRowMigrations(db) {
  for (const m of ROW_MIGRATIONS) {
    try {
      const r = await db.runAsync(m[db.engine]);
      if (r && r.changes) console.log(`[db] migration: added reference row to ${m.table}`);
    } catch (e) {
      console.warn(`[db] row migration ${m.table} skipped:`, (e && e.message) || e);
    }
  }
}

async function runColumnMigrations(db) {
  let added = 0;
  for (const [table, col, type] of COLUMN_MIGRATIONS) {
    try {
      await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      added++;
      console.log(`[db] migration: added ${table}.${col}`);
    } catch (e) {
      // Expected on an up-to-date DB: duplicate column / (fresh boot) table not
      // yet created. Anything else is worth a line, but never fatal.
      const m = (e && e.message) || '';
      if (!/duplicate column|already exists|no such table|doesn't exist|Duplicate column/i.test(m)) {
        console.warn(`[db] migration ${table}.${col} skipped:`, m);
      }
    }
  }
  if (added) console.log(`[db] applied ${added} column migration(s)`);
}

function init(appConfig) {
  const dbCfg = appConfig.database || {};
  const engine = dbCfg.engine === 'mysql' ? 'mysql' : 'sqlite';
  let db;
  if (engine === 'mysql') {
    console.log(`[db] Using MySQL (${dbCfg.mysql.host}:${dbCfg.mysql.port}/${dbCfg.mysql.database})`);
    db = initMysql(dbCfg.mysql || {});
  } else {
    console.log(`[db] Using SQLite (${dbCfg.sqlite && dbCfg.sqlite.filename || 'mmoa_web_app.db'})`);
    db = initSqlite(dbCfg.sqlite || {});
  }
  // Fire-and-forget at boot: idempotent + error-tolerant.
  // Awaits db.ready first, so a fresh SQLite bootstrap has finished. Callers
  // that must see the migrated schema (scripts) can await db.migrated.
  db.migrated = db.ready
    .then(() => runSchemaV2Migrations(db))
    .then(() => runTableMigrations(db))
    .then(() => runColumnMigrations(db))
    .then(() => runRowMigrations(db))
    .catch(e => console.error('[db] migrations failed:', e.message || e));
  return db;
}

module.exports = { init, COLUMN_MIGRATIONS, TABLE_MIGRATIONS, SCHEMA_V2_TABLES, schemaStatements };
