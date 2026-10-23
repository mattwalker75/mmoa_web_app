// test/schema.test.js — run with `npm test` (node's built-in runner).
// db/database.js reads the boot-migration DDL + seeds straight out of
// setup_sqlite_db.sql / setup_mysql_db.sql with a naive ';' split. If a
// future seed puts a ';' inside a string literal, the split silently yields
// half-statements — this test fails first, instead of production.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { schemaStatements, SCHEMA_V2_TABLES } = require('../db/database');

for (const engine of ['sqlite', 'mysql']) {
  test(`${engine}: every SCHEMA_V2_TABLES entry has a CREATE TABLE in setup_${engine}_db.sql`, () => {
    const { creates, seeds } = schemaStatements(engine);
    for (const table of SCHEMA_V2_TABLES) {
      const stmts = creates[table] || [];
      assert.ok(stmts.some(s => new RegExp(`^CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i').test(s)),
        `${table}: no CREATE TABLE statement parsed`);
      // A statement that lost its tail to a stray ';' would end mid-column.
      for (const s of stmts) {
        if (/^CREATE TABLE/i.test(s)) assert.match(s, /\)\s*(ENGINE=InnoDB[^;]*)?$/i, `${table}: CREATE TABLE does not end with ')': ${s.slice(-60)}`);
      }
    }
    // Reference seeds the app depends on were parsed whole.
    assert.ok((seeds.categories || []).length >= 1, 'categories seed parsed');
    assert.ok((seeds.cities || []).length >= 1, 'cities seed parsed');
    assert.ok((seeds.board_members || []).length >= 1, 'board_members seed parsed');
    for (const [table, list] of Object.entries(seeds)) {
      for (const s of list) {
        // Balanced quotes: an odd count means the split landed inside a literal.
        assert.equal((s.match(/'/g) || []).length % 2, 0, `${table}: seed statement has an unbalanced quote: ${s.slice(0, 80)}`);
      }
    }
  });

  test(`${engine}: no ';' inside a string literal in setup_${engine}_db.sql`, () => {
    const text = fs.readFileSync(path.join(__dirname, '..', `setup_${engine}_db.sql`), 'utf8');
    // Walk the file tracking single-quote state (SQL doubles a quote to
    // escape it, which this treats as two toggles — the state is unchanged).
    let inStr = false;
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') line++;
      if (!inStr && ch === '-' && text[i + 1] === '-') {
        while (i < text.length && text[i] !== '\n') i++;
        line++;
        continue;
      }
      if (ch === "'") inStr = !inStr;
      else if (ch === ';' && inStr) assert.fail(`setup_${engine}_db.sql line ${line}: ';' inside a string literal`);
    }
    assert.equal(inStr, false, 'unterminated string literal');
  });
}
