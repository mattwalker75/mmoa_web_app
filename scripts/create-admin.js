#!/usr/bin/env node
// scripts/create-admin.js — one-shot helper to create an organizer (admin) user.
//
// Usage:
//   node scripts/create-admin.js <login_name> <email> '<first_name>' '<last_name>' '<password>'
//
// Idempotent: if the email or login name already exists, it upgrades that
// user to admin + sets email_verified_at and resets the password. login_name
// is also updated to match the argument.
//
// The web app has no admin pages — the role matters to the admin console
// (mmoa_admin_console), which can also create and edit users itself. This
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
    console.error('Usage: node scripts/create-admin.js <login_name> <email> <first_name> <last_name> <password>');
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
      "UPDATE users SET login_name = ?, email = ?, first_name = ?, last_name = ?, password_hash = ?, role = 'admin', is_active = 1, email_verified_at = COALESCE(email_verified_at, ?) WHERE user_id = ?",
      [loginName, email, firstName, lastName, hash, now, existing.user_id]
    );
    console.log(`Updated existing user (id=${existing.user_id}) to admin: ${email}`);
  } else {
    const ins = await db.runAsync(
      "INSERT INTO users (login_name, email, first_name, last_name, password_hash, role, is_active, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, 'admin', 1, ?, ?)",
      [loginName, email, firstName, lastName, hash, now, now]
    );
    console.log(`Created admin user (id=${ins.lastID}): ${email}`);
  }

  // Give SQLite a beat to flush; mysql2 pool needs an explicit close.
  if (db.raw && typeof db.raw.end === 'function') db.raw.end();
  setTimeout(() => process.exit(0), 200);
}

main().catch(err => {
  console.error('[create-admin] failed:', err);
  process.exit(1);
});
