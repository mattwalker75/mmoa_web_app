// routes/api.js — JSON API consumed by the Angular SPA (frontend/mmoa-web-ui/).
//
// Mounted at /api in app.js, AFTER the express.json() body parser.
//
// Auth model: a signed cookie-session (mw_session). These endpoints answer
// 401/403 with JSON (never redirects) so the SPA can react in-app. There is
// NO admin surface here — nonprofits, events, raffles, website content and
// settings are managed from the separate mmoa_admin_console, which edits this app's files
// and database directly.
//
// Endpoint map:
//   GET  /api/public/config              — safe public config for the SPA
//   (public content — routes/public.js)
//   GET  /api/site                       — org facts + website sections (HTML/)
//   GET  /api/events[?when=past], /api/events/:slug
//   GET  /api/raffles[?status=past], /api/raffles/:slug
//   GET  /api/board
//   GET  /api/directory/meta, /api/directory/search, /api/directory/orgs/:id
//   (accounts — below; logins exist only for partner nonprofits)
//   POST /api/auth/signup                — create account + organization, send verification email
//   POST /api/auth/login                 — authenticate, set session
//   POST /api/auth/logout                — clear session
//   GET  /api/auth/me                    — current session user (or null)
//   POST /api/auth/change-password       — change own password (signed in)
//   POST /api/auth/verify                — consume an email-verification token
//   POST /api/auth/resend-verification   — re-issue a verification email
//   POST /api/auth/forgot-password       — issue a single-use reset link
//   POST /api/auth/reset-password/check  — is a reset link still good? (non-consuming)
//   POST /api/auth/reset-password        — consume a reset token, set new password
//   (nonprofit portal — routes/portal.js; signed in + email verified)
//   GET/PUT /api/portal/org, POST /api/portal/org/images,
//   DELETE /api/portal/org/images/:id, PUT /api/portal/org/images/order
//
// email.showLinksInBrowser (TESTING / TEMPORARY): signup, resend-verification
// and forgot-password ALSO return the emailed link as `devLink` so the flows
// can be completed before email is set up. See devLinkFields() below.

const express = require('express');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../middleware/auth');
const { checkLockout, recordFailure, resetLockout } = require('../middleware/loginLockout');
const { newToken } = require('../helpers/tokens');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../helpers/email');
const { normalizeEin } = require('./portal');

const { sqlTime, parseSqlTimeMs, isoOrNull } = require('../helpers/sqlTime');

// A throwaway bcrypt hash compared against when the supplied login matches no
// user, so an unknown-account response takes the same time as a wrong-password
// one (no account-enumeration timing oracle). It's a real bcrypt hash of a
// random string — the comparison always fails.
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.7jR8pVxR1Q5y0fJ8xqI7Qe6Yk2dG';

// ── Account field validation (strict allowlists) ────────────────────────
const NAME_RE = /^[\p{L}\p{M} .,'-]{1,100}$/u;                       // letters/marks + name punctuation
const EMAIL_STRICT_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// Account login name: letters/digits with . _ - separators, 3–30 chars.
const LOGIN_NAME_RE = /^[A-Za-z0-9._-]{3,30}$/;
// Optional phone: digits plus the usual punctuation, 7–32 chars.
const PHONE_RE = /^[0-9+().\- ]{7,32}$/;

module.exports = function (db, appConfig) {
  const router = express.Router();

  // ── JSON auth guards ──────────────────────────────────────────────────
  // Password-version stamp kept in the session: a password change or reset
  // anywhere (including the admin console) invalidates every other cookie on
  // its next request.
  function pwVersion(hash) { return crypto.createHash('sha256').update(String(hash || '')).digest('hex').slice(0, 16); }

  // Cookie sessions are stateless, so each authenticated API call re-reads
  // the account (one primary-key lookup): deactivated in the admin console,
  // deleted, or password changed elsewhere → the session is dropped and the
  // call gets 401. The same read refreshes email_verified_at.
  async function refreshSessionUser(req) {
    const s = req.session && req.session.user;
    if (!s) return null;
    let u;
    try {
      u = await db.getAsync('SELECT user_id, is_active, password_hash, email_verified_at FROM users WHERE user_id = ?', [s.user_id]);
    } catch (e) {
      return s; // a DB blip should not log everyone out
    }
    // Every login stamps pv; a session without one was not issued by a
    // login (e.g. forged with leaked signing keys) — never accept it.
    if (!u || !u.is_active || !s.pv || s.pv !== pwVersion(u.password_hash)) {
      req.session = null;
      return null;
    }
    s.email_verified_at = u.email_verified_at;
    return s;
  }
  async function requireUser(req, res, next) {
    if (await refreshSessionUser(req)) return next();
    res.status(401).json({ error: 'Not signed in' });
  }
  // Portal routes: signed in AND email verified (login already refuses
  // unverified accounts; this re-checks the live row on every call).
  async function requireVerified(req, res, next) {
    const s = await refreshSessionUser(req);
    if (!s) return res.status(401).json({ error: 'Not signed in' });
    if (!s.email_verified_at) return res.status(403).json({ error: 'Please verify your email first.', code: 'unverified' });
    next();
  }

  // Minutes an email-verification link stays valid:
  // security.verificationLinkExpiresMinutes, else 60.
  function verificationExpiryMinutes() {
    const sec = appConfig.security || {};
    if (Number.isFinite(sec.verificationLinkExpiresMinutes) && sec.verificationLinkExpiresMinutes > 0) {
      return sec.verificationLinkExpiresMinutes;
    }
    return 60;
  }

  function baseUrl() {
    return (appConfig.publicBaseUrl || `http://localhost:${appConfig.port}`).replace(/\/+$/, '');
  }

  // ── Email-verification bypass (TESTING / TEMPORARY) ───────────────────
  // With email.showLinksInBrowser on, the link we just emailed is also
  // returned as `devLink` so the SPA can show it ("Email isn't set up yet —
  // click here…"). It is read live from appConfig on every call. This
  // deliberately gives up two protections while it is on: anyone can verify
  // an address they don't own, and (via forgot-password) take over any
  // account whose email they know; resend/forgot also stop being
  // enumeration-safe (devLink appears only for real accounts). Hence the
  // loud boot warning in app.js — turn it off as soon as email works.
  function showLinks() {
    return !!(appConfig.email && appConfig.email.showLinksInBrowser === true);
  }
  function devLinkFields(url) {
    return (showLinks() && url) ? { devLink: url } : {};
  }

  // req.body is undefined when no body parser matched (wrong content type),
  // and a JSON body can carry any type in any field. Pull the named fields
  // out as strings (absent → ''); a non-string value is answered with a JSON
  // 400 and null is returned — so a handler never TypeErrors into a 500 (or,
  // for the fields read before a try block, into the default error page).
  function bodyStrings(req, res, keys) {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const out = {};
    for (const k of keys) {
      const v = b[k];
      if (v != null && typeof v !== 'string') {
        res.status(400).json({ error: `${k} must be text` });
        return null;
      }
      out[k] = v || '';
    }
    return out;
  }

  function publicUser(u) {
    return {
      user_id: u.user_id,
      login_name: u.login_name,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      phone_number: u.phone_number || null,
      email_verified: !!u.email_verified_at,
      created_at: isoOrNull(u.created_at)
    };
  }

  // ── Public config (safe subset only) ──────────────────────────────────
  router.get('/public/config', (req, res) => {
    res.json({
      appTitle: appConfig.appTitle || 'Mission Men of Anna',
      appSubtitle: appConfig.appSubtitle || '',
      orgName: appConfig.orgName || 'Mission Men of Anna Inc',
      allowMemberRegistration: appConfig.allowMemberRegistration !== false,
      passwordMinLength: appConfig.passwordMinLength || 8,
      showLinksInBrowser: showLinks()
    });
  });

  // ── Public content: site sections, events, raffles, board, directory ──
  router.use(require('./public')(db, appConfig));

  // ── Nonprofit portal (signed in + email verified) ─────────────────────
  router.use('/portal', require('./portal')(db, appConfig, { requireVerified }));

  // ── Sign up (nonprofit) ───────────────────────────────────────────────
  // Creates the login (users) AND its organization (unverified) in one
  // transaction, then emails the verification link. first_name / last_name
  // are the org's primary contact person.
  router.post('/auth/signup', async (req, res) => {
    if (appConfig.allowMemberRegistration === false) {
      return res.status(403).json({ error: 'Sign up is currently disabled' });
    }
    const b = bodyStrings(req, res, ['org_name', 'ein', 'login_name', 'first_name', 'last_name', 'phone_number', 'email', 'password', 'confirm_password']);
    if (!b) return;
    try {
      const orgName = b.org_name.trim();
      const einRaw = b.ein.trim();
      const loginName = b.login_name.trim();
      const firstName = b.first_name.trim();
      const lastName = b.last_name.trim();
      const phoneNumber = b.phone_number.trim() || null;
      const email = b.email.trim().toLowerCase();
      const password = b.password;
      const confirm = b.confirm_password;
      const minLen = appConfig.passwordMinLength || 8;

      if (!orgName || !einRaw || !loginName || !firstName || !lastName || !email || !password) {
        return res.status(400).json({ error: 'All required fields must be filled' });
      }
      if (orgName.length < 2 || orgName.length > 200 || /[<>]/.test(orgName)) {
        return res.status(400).json({ error: 'Please enter your organization\'s name (2–200 characters)' });
      }
      const ein = normalizeEin(einRaw);
      if (!ein) {
        return res.status(400).json({ error: 'EIN must be 9 digits (for example 12-3456789)' });
      }
      if (!LOGIN_NAME_RE.test(loginName)) {
        return res.status(400).json({ error: 'Login name must be 3–30 characters using letters, numbers, and . _ - only' });
      }
      if (!NAME_RE.test(firstName) || !NAME_RE.test(lastName)) {
        return res.status(400).json({ error: 'Names may only contain letters, spaces, and . , \' -' });
      }
      if (phoneNumber && !PHONE_RE.test(phoneNumber)) {
        return res.status(400).json({ error: 'Please enter a valid phone number' });
      }
      if (!EMAIL_STRICT_RE.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }
      if (password.length < minLen) {
        return res.status(400).json({ error: `Password must be at least ${minLen} characters` });
      }
      if (password.length > 128) {
        return res.status(400).json({ error: 'Password must be 128 characters or less' });
      }
      if (password !== confirm) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }

      // Login names are case-insensitive on both engines: MySQL's collation
      // already is, and SQLite gets a NOCASE unique index (db/database.js);
      // the lookup lowercases both sides so the two behave identically.
      const existing = await db.getAsync(
        'SELECT user_id, email, login_name FROM users WHERE email = ? OR LOWER(login_name) = LOWER(?)',
        [email, loginName]
      );
      if (existing) {
        if (existing.email === email) {
          return res.status(409).json({ error: 'An account with that email already exists' });
        }
        return res.status(409).json({ error: 'That login name is already taken' });
      }

      const hash = await hashPassword(password);
      const token = newToken(32);
      const expiresMinutes = verificationExpiryMinutes();
      const now = sqlTime(Date.now());
      // Account + organization + token together: a failure part-way leaves
      // nothing behind (no orphan login without its org, or vice versa).
      await db.transaction(async (tx) => {
        const ins = await tx.runAsync(
          `INSERT INTO users (login_name, email, first_name, last_name, phone_number, password_hash, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
          [loginName, email, firstName, lastName, phoneNumber, hash, now]
        );
        const userId = ins.lastID;
        await tx.runAsync(
          `INSERT INTO organizations (user_id, name, ein, state, verification_status, created_at, updated_at)
           VALUES (?, ?, ?, 'TX', 'unverified', ?, ?)`,
          [userId, orgName, ein, now, now]
        );
        await tx.runAsync(
          'INSERT INTO email_verification_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)',
          [userId, token, sqlTime(Date.now() + expiresMinutes * 60 * 1000), now]
        );
      });

      const verifyUrl = baseUrl() + '/verify?token=' + token;
      // The account already exists at this point, so a failed send must not
      // turn into a 500 (a retry would then hit "email already exists"). Log
      // it; they can use "Resend email" on the next page.
      let message = 'Check your email to verify your account.';
      try {
        await sendVerificationEmail(appConfig, { to: email, firstName, verifyUrl, expiresMinutes });
      } catch (e) {
        console.error('[api] signup verification email failed:', e.message || e);
        message = "Your account was created, but we couldn't send the verification email just now. Use \"Resend email\" to try again.";
      }

      res.status(201).json({ ok: true, email, message, ...devLinkFields(verifyUrl) });
    } catch (err) {
      // Two signups racing past the pre-check land here on the UNIQUE index;
      // that's a conflict, not a server error.
      if (/UNIQUE constraint failed|Duplicate entry|ER_DUP_ENTRY/i.test((err && err.message) || err && err.code || '')) {
        return res.status(409).json({ error: 'An account with that email or login name already exists' });
      }
      console.error('[api] signup failed:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // ── Log in ────────────────────────────────────────────────────────────
  router.post('/auth/login', async (req, res) => {
    const ip = req.ip;
    const b = bodyStrings(req, res, ['identifier', 'password']);
    if (!b) return;
    const identifier = b.identifier.trim();
    try {
      // Per-IP + per-account brute-force gate: refuse before any bcrypt work.
      const lk = await checkLockout(db, appConfig, { ip, identifier });
      if (lk.manual) {
        return res.status(403).json({ error: 'This account has been locked by Mission Men of Anna. Contact MMoA to restore access.', code: 'account_locked' });
      }
      if (lk.locked) {
        res.set('Retry-After', String(lk.retryAfter));
        return res.status(429).json({
          error: `Too many failed login attempts. Try again in ${lk.retryAfter} seconds.`,
          code: 'locked',
          retryAfter: lk.retryAfter
        });
      }

      const password = b.password;
      if (!identifier || !password) {
        return res.status(400).json({ error: 'Login and password are required' });
      }
      const u = await db.getAsync(
        `SELECT user_id, login_name, email, first_name, last_name, phone_number,
                password_hash, is_active, email_verified_at, created_at
           FROM users WHERE email = ? OR LOWER(login_name) = LOWER(?)`,
        [identifier.toLowerCase(), identifier]
      );
      const generic = { error: 'Invalid login or password' };
      // Unknown / inactive account: still run a bcrypt compare against a dummy
      // hash so the response time matches the wrong-password path, then count
      // it as a failed attempt.
      if (!u || !u.is_active) {
        await verifyPassword(password, DUMMY_HASH);
        await recordFailure(db, appConfig, { ip, identifier });
        return res.status(401).json(generic);
      }

      const ok = await verifyPassword(password, u.password_hash);
      if (!ok) {
        await recordFailure(db, appConfig, { ip, identifier });
        return res.status(401).json(generic);
      }

      if (!u.email_verified_at) {
        // Valid credentials — clear the failure counters even though the email
        // gate blocks the session, so a verified retry isn't penalized.
        await resetLockout(db, { ip, identifier });
        return res.status(403).json({ error: 'Please verify your email before signing in.', code: 'unverified', email: u.email });
      }

      // Success: clear this IP's + account's failure history.
      await resetLockout(db, { ip, identifier });

      req.session.user = {
        user_id: u.user_id,
        login_name: u.login_name,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        email_verified_at: u.email_verified_at,
        pv: pwVersion(u.password_hash) // see refreshSessionUser
      };
      await db.runAsync('UPDATE users SET last_login_at = ? WHERE user_id = ?', [sqlTime(Date.now()), u.user_id]);

      res.json({ user: publicUser(u) });
    } catch (err) {
      console.error('[api] login failed:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  router.post('/auth/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  // Re-reads the row rather than echoing the session copy: profile edits
  // made in the admin console show up without a re-login.
  router.get('/auth/me', async (req, res) => {
    const s = await refreshSessionUser(req); // drops deactivated / re-passworded sessions
    if (!s) return res.json({ user: null });
    try {
      const u = await db.getAsync(
        'SELECT user_id, login_name, email, first_name, last_name, phone_number, email_verified_at, created_at FROM users WHERE user_id = ?',
        [s.user_id]
      );
      res.json({ user: publicUser(u || s) });
    } catch (err) {
      res.json({ user: publicUser(s) });
    }
  });

  // ── Change my own account password (signed-in, self-service) ──────────
  // Requires the current password (so a hijacked-but-idle session can't
  // silently change it). A wrong current password counts against the same
  // per-IP + per-account lockout as a failed login (keyed on the account's
  // login name), so a stolen cookie can't be used to guess it; the per-IP
  // auth rate limiter in app.js caps the raw volume on top.
  router.post('/auth/change-password', requireUser, async (req, res) => {
    const b = bodyStrings(req, res, ['current_password', 'new_password', 'confirm_password']);
    if (!b) return;
    const current = b.current_password;
    const next = b.new_password;
    const confirm = b.confirm_password;
    const minLen = appConfig.passwordMinLength || 8;
    if (!current) return res.status(400).json({ error: 'Enter your current password' });
    if (next.length < minLen) return res.status(400).json({ error: `New password must be at least ${minLen} characters` });
    if (next.length > 128) return res.status(400).json({ error: 'New password must be 128 characters or less' });
    if (next !== confirm) return res.status(400).json({ error: 'New passwords do not match' });
    if (next === current) return res.status(400).json({ error: 'Choose a password different from your current one' });
    try {
      const userId = req.session.user.user_id;
      // Session doesn't carry the hash — fetch it fresh.
      const u = await db.getAsync('SELECT login_name, password_hash FROM users WHERE user_id = ?', [userId]);
      if (!u) return res.status(401).json({ error: 'Not signed in' });
      const ip = req.ip;
      const identifier = u.login_name;
      const lk = await checkLockout(db, appConfig, { ip, identifier });
      if (lk.manual) {
        return res.status(403).json({ error: 'This account has been locked by Mission Men of Anna. Contact MMoA to restore access.', code: 'account_locked' });
      }
      if (lk.locked) {
        res.set('Retry-After', String(lk.retryAfter));
        return res.status(429).json({
          error: `Too many incorrect password attempts. Try again in ${lk.retryAfter} seconds.`,
          code: 'locked',
          retryAfter: lk.retryAfter
        });
      }
      const ok = await verifyPassword(current, u.password_hash);
      if (!ok) {
        await recordFailure(db, appConfig, { ip, identifier });
        return res.status(400).json({ error: 'Your current password is incorrect' });
      }
      await resetLockout(db, { ip, identifier });
      const hash = await hashPassword(next);
      await db.runAsync('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, userId]);
      // Keep THIS session alive; every other cookie now fails the pv check.
      req.session.user.pv = pwVersion(hash);
      res.json({ ok: true, message: 'Your password has been updated. Any other signed-in sessions have been signed out.' });
    } catch (err) {
      console.error('[api] change-password failed:', err);
      res.status(500).json({ error: 'Could not update your password. Please try again.' });
    }
  });

  // ── Verify email (token from the emailed link) ────────────────────────
  router.post('/auth/verify', async (req, res) => {
    const b = bodyStrings(req, res, ['token']);
    if (!b) return;
    const token = b.token.trim();
    if (!token) return res.status(400).json({ error: 'Missing verification token' });
    try {
      const row = await db.getAsync(
        `SELECT t.token_id, t.user_id, t.expires_at, t.consumed_at, u.email
           FROM email_verification_tokens t JOIN users u ON t.user_id = u.user_id
          WHERE t.token = ?`,
        [token]
      );
      if (!row) return res.status(400).json({ error: 'This verification link is not valid.' });
      if (row.consumed_at) return res.json({ ok: true, alreadyVerified: true });
      const verifyExp = parseSqlTimeMs(row.expires_at);
      if (!Number.isFinite(verifyExp) || Date.now() > verifyExp) {
        return res.status(400).json({ error: 'This verification link has expired.', code: 'expired', email: row.email });
      }
      const now = sqlTime(Date.now());
      await db.transaction(async (tx) => {
        await tx.runAsync('UPDATE email_verification_tokens SET consumed_at = ? WHERE token_id = ?', [now, row.token_id]);
        // COALESCE: re-verifying via a second link keeps the original stamp.
        await tx.runAsync('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE user_id = ?', [now, row.user_id]);
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('[api] verify failed:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }
  });

  // The "account exists" paths below REPLY before the email goes out and
  // send it in the background (logging a failure): awaiting the send would
  // make a real address answer measurably slower than an unknown one — a
  // timing oracle on the enumeration-safe reply. The token row is written
  // first (fast, and it keeps devLink valid while showLinksInBrowser is on).
  function sendInBackground(label, promise) {
    promise.catch(e => console.error(`[api] ${label} email failed:`, (e && e.message) || e));
  }

  router.post('/auth/resend-verification', async (req, res) => {
    const b = bodyStrings(req, res, ['email']);
    if (!b) return;
    const email = b.email.trim().toLowerCase();
    // Always answer ok (no account enumeration — except via devLink while
    // the TESTING showLinksInBrowser switch is on).
    const done = (extra) => { if (!res.headersSent) res.json({ ok: true, message: 'If that account exists and is unverified, a new link is on its way.', ...(extra || {}) }); };
    if (!email) return done();
    try {
      const u = await db.getAsync('SELECT user_id, first_name, email, email_verified_at FROM users WHERE email = ?', [email]);
      if (!u || u.email_verified_at) return done();
      const token = newToken(32);
      const expiresMinutes = verificationExpiryMinutes();
      await db.runAsync(
        'INSERT INTO email_verification_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)',
        [u.user_id, token, sqlTime(Date.now() + expiresMinutes * 60 * 1000), sqlTime(Date.now())]
      );
      const verifyUrl = baseUrl() + '/verify?token=' + token;
      done(devLinkFields(verifyUrl));
      sendInBackground('resend-verification', sendVerificationEmail(appConfig, { to: u.email, firstName: u.first_name, verifyUrl, expiresMinutes }));
    } catch (err) {
      console.error('[api] resend-verification failed:', err);
      done();
    }
  });

  // ── Forgot password: issue a single-use reset link ────────────────────
  router.post('/auth/forgot-password', async (req, res) => {
    const b = bodyStrings(req, res, ['email']);
    if (!b) return;
    const email = b.email.trim().toLowerCase();
    const done = (extra) => { if (!res.headersSent) res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.', ...(extra || {}) }); };
    if (!email) return done();
    try {
      const u = await db.getAsync('SELECT user_id, first_name, email, is_active FROM users WHERE email = ?', [email]);
      // Inactive accounts can't sign in anyway; don't hand them a reset link.
      if (!u || !u.is_active) return done();
      // Invalidate any outstanding reset tokens for this user before issuing a
      // fresh one, so only the newest link is live.
      await db.runAsync(
        'UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
        [sqlTime(Date.now()), u.user_id]
      );
      const token = newToken(32);
      const ttlHours = appConfig.passwordResetTokenTtlHours || 2;
      await db.runAsync(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)',
        [u.user_id, token, sqlTime(Date.now() + ttlHours * 3600 * 1000), sqlTime(Date.now())]
      );
      const resetUrl = baseUrl() + '/reset-password?token=' + token;
      done(devLinkFields(resetUrl));
      sendInBackground('forgot-password', sendPasswordResetEmail(appConfig, { to: u.email, firstName: u.first_name, resetUrl, ttlHours }));
    } catch (err) {
      console.error('[api] forgot-password failed:', err);
      done();
    }
  });

  // ── Is this reset link still good? (never consumes it) ────────────────
  // Called by the reset page on load so a dead link is refused before the
  // user types anything. Safe to expose: tokens are 32 random bytes, so only
  // the link's holder can ask. Reports WHY it's dead — expired, used, or
  // replaced by a newer request — because "used" on a link the member never
  // clicked is worth telling them, while "replaced" is not alarming. Submit
  // re-validates regardless; this is a courtesy, not the boundary.
  router.post('/auth/reset-password/check', async (req, res) => {
    const b = bodyStrings(req, res, ['token']);
    if (!b) return;
    const token = b.token.trim();
    if (!token) return res.json({ ok: false, code: 'invalid' });
    try {
      const row = await db.getAsync(
        'SELECT token_id, user_id, expires_at, consumed_at FROM password_reset_tokens WHERE token = ?',
        [token]
      );
      if (!row) return res.json({ ok: false, code: 'invalid' });
      if (row.consumed_at) {
        // forgot-password consumes older tokens when it issues a new one, so
        // a consumed token with a newer live sibling was superseded, not used.
        const newer = await db.getAsync(
          'SELECT 1 AS x FROM password_reset_tokens WHERE user_id = ? AND token_id > ? AND consumed_at IS NULL LIMIT 1',
          [row.user_id, row.token_id]
        );
        return res.json({ ok: false, code: newer ? 'superseded' : 'used' });
      }
      const exp = parseSqlTimeMs(row.expires_at);
      if (!Number.isFinite(exp) || Date.now() > exp) return res.json({ ok: false, code: 'expired' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[api] reset-password check failed:', err);
      // Fail open to the form: submit still validates.
      res.json({ ok: true });
    }
  });

  // ── Reset password (single-use token) ─────────────────────────────────
  router.post('/auth/reset-password', async (req, res) => {
    const b = bodyStrings(req, res, ['token', 'password', 'confirm_password']);
    if (!b) return;
    const token = b.token.trim();
    const password = b.password;
    const confirm = b.confirm_password;
    const minLen = appConfig.passwordMinLength || 8;
    if (!token) return res.status(400).json({ error: 'Missing reset token' });
    if (password.length < minLen) return res.status(400).json({ error: `Password must be at least ${minLen} characters` });
    if (password.length > 128) return res.status(400).json({ error: 'Password must be 128 characters or less' });
    if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match' });
    try {
      const row = await db.getAsync(
        'SELECT token_id, user_id, expires_at, consumed_at FROM password_reset_tokens WHERE token = ?',
        [token]
      );
      if (!row || row.consumed_at) {
        return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
      }
      const resetExp = parseSqlTimeMs(row.expires_at);
      if (!Number.isFinite(resetExp) || Date.now() > resetExp) {
        return res.status(400).json({ error: 'This reset link has expired. Please request a new one.', code: 'expired' });
      }
      const hash = await hashPassword(password);
      // Consume the token and update the password in one transaction so the
      // link can never be replayed even on a race.
      await db.transaction(async (tx) => {
        const upd = await tx.runAsync(
          'UPDATE password_reset_tokens SET consumed_at = ? WHERE token_id = ? AND consumed_at IS NULL',
          [sqlTime(Date.now()), row.token_id]
        );
        if (!upd.changes) throw new Error('token already consumed');
        await tx.runAsync('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, row.user_id]);
      });
      res.json({ ok: true, message: 'Your password has been reset. You can now sign in.' });
    } catch (err) {
      if (err && err.message === 'token already consumed') {
        return res.status(400).json({ error: 'This reset link has already been used.' });
      }
      console.error('[api] reset-password failed:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  return router;
};

// Exported for scripts/tests that need the same time handling (now kept in
// helpers/sqlTime.js; re-exported here for older callers).
module.exports.sqlTime = sqlTime;
module.exports.parseSqlTimeMs = parseSqlTimeMs;
