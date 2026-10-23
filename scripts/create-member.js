#!/usr/bin/env node
// scripts/create-member.js — one-shot helper to create a ready-to-use
// nonprofit login (users row + its organizations row).
//
// Usage:
//   node scripts/create-member.js <login_name> <email> '<first_name>' '<last_name>' [--org "<org name>"]
//
// The password is read from the MEMBER_PASSWORD environment variable, or
// prompted for on the terminal when that is unset:
//   MEMBER_PASSWORD='…' node scripts/create-member.js pantry pantry@example.org 'First' 'Last'
// It may still be passed as a 5th argument (older usage), but that leaves it
// visible in `ps` and the shell history, so the script warns.
//
// The account is created already email-verified and active, so it can sign
// in immediately (no verification link needed). Its organization is created
// UNVERIFIED (not shown in "Need Help?" until MMoA verifies it in the
// console), named --org or, by default, "<first_name> <last_name>".
// Idempotent: if the email or login name already exists, that account is
// re-activated, marked verified, and gets the new password; login_name is
// also updated to match. An existing organization is kept (renamed only when
// --org is given).
//
// The admin console (mmoa_admin_console → Nonprofits) manages accounts too;
// this script is for bootstrapping a box before the console is connected.

const { appConfig } = require('../config/appConfig');
const { init: initDb } = require('../db/database');
const { hashPassword } = require('../middleware/auth');

// UTC 'YYYY-MM-DD HH:MM:SS' — the format every timestamp column uses.
function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\..+/, '');
}

// Read the password without echoing it (terminal), or as one line when
// stdin is piped (e.g. from a secrets tool).
function promptPassword(label) {
  return new Promise((resolve, reject) => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
    if (process.stdin.isTTY) {
      // Suppress the echo of what is typed; keep the prompt itself visible.
      let muted = false;
      rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
      process.stderr.write(label);
      muted = true;
      rl.question('', (answer) => { muted = false; process.stderr.write('\n'); rl.close(); resolve(answer); });
    } else {
      rl.once('line', (line) => { rl.close(); resolve(line); });
      rl.once('close', () => resolve(''));
    }
    rl.once('error', reject);
  });
}

async function main() {
  // Pull out --org "<name>" (or --org=<name>) wherever it appears.
  const args = process.argv.slice(2);
  let orgArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--org') { orgArg = args[i + 1] || ''; args.splice(i, 2); i--; }
    else if (args[i].startsWith('--org=')) { orgArg = args[i].slice(6); args.splice(i, 1); i--; }
  }
  const [loginRaw, emailRaw, firstRaw, lastRaw, passwordArg] = args;
  if (!loginRaw || !emailRaw || !firstRaw || !lastRaw || orgArg === '') {
    console.error('Usage: MEMBER_PASSWORD=… node scripts/create-member.js <login_name> <email> <first_name> <last_name> [--org "<org name>"]');
    console.error('       (or omit MEMBER_PASSWORD to be prompted for the password)');
    process.exit(1);
  }
  const loginName = loginRaw.trim();
  const email = emailRaw.trim().toLowerCase();
  const firstName = firstRaw.trim();
  const lastName = lastRaw.trim();
  const minLen = appConfig.passwordMinLength || 8;

  // Password: argv (warned — visible in ps / shell history) > MEMBER_PASSWORD > prompt.
  let password;
  if (passwordArg) {
    console.warn('[create-member] WARNING: the password was given on the command line, where `ps` and your shell history can see it. Prefer MEMBER_PASSWORD=… or the prompt.');
    password = passwordArg;
  } else if (process.env.MEMBER_PASSWORD) {
    password = process.env.MEMBER_PASSWORD;
  } else {
    password = await promptPassword(`Password for ${loginName}: `);
  }
  if (!password) {
    console.error('A password is required (MEMBER_PASSWORD, the prompt, or the 5th argument).');
    process.exit(1);
  }
  if (password.length < minLen) {
    console.error(`Password must be at least ${minLen} characters.`);
    process.exit(1);
  }

  const db = initDb(appConfig);
  // Wait for a fresh SQLite file's schema bootstrap + the boot migrations.
  await db.migrated;

  const hash = await hashPassword(password);
  const now = sqlTime(Date.now());
  const existing = await db.getAsync(
    'SELECT user_id FROM users WHERE email = ? OR LOWER(login_name) = LOWER(?)',
    [email, loginName]
  );
  if (existing) {
    await db.runAsync(
      "UPDATE users SET login_name = ?, email = ?, first_name = ?, last_name = ?, password_hash = ?, is_active = 1, email_verified_at = COALESCE(email_verified_at, ?) WHERE user_id = ?",
      [loginName, email, firstName, lastName, hash, now, existing.user_id]
    );
    console.log(`Updated existing account (id=${existing.user_id}): ${email}`);
  } else {
    const ins = await db.runAsync(
      "INSERT INTO users (login_name, email, first_name, last_name, password_hash, is_active, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      [loginName, email, firstName, lastName, hash, now, now]
    );
    console.log(`Created account (id=${ins.lastID}): ${email}`);
  }

  // The account's organization (1:1).
  const user = await db.getAsync('SELECT user_id FROM users WHERE email = ?', [email]);
  const org = await db.getAsync('SELECT org_id, name FROM organizations WHERE user_id = ?', [user.user_id]);
  const orgName = (orgArg || `${firstName} ${lastName}`).trim();
  if (!org) {
    const ins = await db.runAsync(
      "INSERT INTO organizations (user_id, name, state, verification_status, created_at, updated_at) VALUES (?, ?, 'TX', 'unverified', ?, ?)",
      [user.user_id, orgName, now, now]
    );
    console.log(`Created organization (id=${ins.lastID}, unverified): ${orgName}`);
  } else if (orgArg && org.name !== orgName) {
    await db.runAsync('UPDATE organizations SET name = ?, updated_at = ? WHERE org_id = ?', [orgName, now, org.org_id]);
    console.log(`Renamed organization (id=${org.org_id}): ${orgName}`);
  } else {
    console.log(`Kept existing organization (id=${org.org_id}): ${org.name}`);
  }

  // Give SQLite a beat to flush; mysql2 pool needs an explicit close.
  if (db.raw && typeof db.raw.end === 'function') db.raw.end();
  setTimeout(() => process.exit(0), 200);
}

main().catch(err => {
  console.error('[create-member] failed:', err);
  process.exit(1);
});
