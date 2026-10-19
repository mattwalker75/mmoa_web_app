#!/usr/bin/env node
// scripts/create-member.js — one-shot helper to create a ready-to-use member.
//
// Usage:
//   node scripts/create-member.js <login_name> <email> '<first_name>' '<last_name>' '<password>'
//
// The account is created already email-verified and active, so it can sign
// in immediately (no verification link needed). Idempotent: if the email or
// login name already exists, that member is re-activated, marked verified,
// and gets the new password; login_name is also updated to match.
//
// The admin console (mmoa_admin_console → Members) can do the same; this
// script is for bootstrapping a box before the console is connected.

const { appConfig } = require('../config/appConfig');
const { init: initDb } = require('../db/database');
const { hashPassword } = require('../middleware/auth');

// UTC 'YYYY-MM-DD HH:MM:SS' — the format every timestamp column uses.
function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\..+/, '');
}

async function main() {
  const [, , loginRaw, emailRaw, firstRaw, lastRaw, passwordRaw] = process.argv;
  if (!loginRaw || !emailRaw || !firstRaw || !lastRaw || !passwordRaw) {
    console.error('Usage: node scripts/create-member.js <login_name> <email> <first_name> <last_name> <password>');
    process.exit(1);
  }
  const loginName = loginRaw.trim();
  const email = emailRaw.trim().toLowerCase();
  const firstName = firstRaw.trim();
  const lastName = lastRaw.trim();
  const password = passwordRaw;
  const minLen = appConfig.passwordMinLength || 8;
  if (password.length < minLen) {
    console.error(`Password must be at least ${minLen} characters.`);
    process.exit(1);
  }

  const db = initDb(appConfig);
  // Wait a moment for SQLite to finish schema bootstrap on a fresh file.
  await new Promise(r => setTimeout(r, 200));

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
    console.log(`Updated existing member (id=${existing.user_id}): ${email}`);
  } else {
    const ins = await db.runAsync(
      "INSERT INTO users (login_name, email, first_name, last_name, password_hash, is_active, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      [loginName, email, firstName, lastName, hash, now, now]
    );
    console.log(`Created member (id=${ins.lastID}): ${email}`);
  }

  // Give SQLite a beat to flush; mysql2 pool needs an explicit close.
  if (db.raw && typeof db.raw.end === 'function') db.raw.end();
  setTimeout(() => process.exit(0), 200);
}

main().catch(err => {
  console.error('[create-member] failed:', err);
  process.exit(1);
});
