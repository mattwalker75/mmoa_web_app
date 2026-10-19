// config/appConfig.js — loads and saves config.json.
//
// Most settings can be re-read from disk by calling reload(); the database
// + email + SSL blocks are only read at startup and require a restart to
// change. The admin console edits config.json remotely (Web App Settings)
// and then offers to restart the app.
//
// `defaults` below is the single source of truth for every key and its
// default value: a key missing from config.json falls back to it, so
// config.json only needs the values that differ.

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

const defaults = {
  port: 3004,
  appTitle: 'Mission Men of Anna',
  appSubtitle: '',
  // Legal name — used in emails and the {{orgName}} website token.
  orgName: 'Mission Men of Anna Inc',
  publicBaseUrl: 'http://localhost:3004',
  // trustProxy defaults to 1 (trust the first proxy hop): this app is
  // internet-facing behind an ALB/nginx, so req.ip must come from
  // X-Forwarded-For or the per-IP login lockout + rate limiter would key off
  // the proxy's IP for every client (one shared bucket → global lockout/DoS).
  // Set to false only when running with no proxy in front.
  server: { ssl: false, keyPath: '', certPath: '', trustProxy: 1 },
  sessionKeyMode: 'auto-generate',
  sessionKeys: ['', ''],
  sessionMaxAgeHours: 8,
  passwordMinLength: 8,
  passwordResetTokenTtlHours: 2,
  allowMemberRegistration: true,
  // Run by the admin console (cwd = this app's directory) to toggle the
  // maintenance screen: --enable --title --message / --disable / --status.
  maintenanceCommand: './scripts/maintenance.sh',
  database: {
    engine: 'sqlite',
    sqlite: { filename: 'mmoa_web_app.db' },
    mysql: { host: 'localhost', port: 3306, database: 'mmoa_web_app', user: 'mmoa_app', password: '', connectionLimit: 10 }
  },
  email: {
    transport: 'console',
    from: 'noreply@example.org',
    replyTo: 'info@example.org',
    // TESTING / TEMPORARY. When true, the endpoints that email a link
    // (signup, resend-verification, forgot-password) ALSO return it to the
    // browser as `devLink`, so the flows work before email is set up. Never
    // leave this on for a real launch — see routes/api.js.
    showLinksInBrowser: false,
    smtp: { host: '', port: 587, secure: false, user: '', password: '' }
  },
  // SES only (email.transport = 'ses'). This app never creates or modifies
  // AWS resources. In AWS set runningInAws=true and leave the keys blank so
  // the EC2 instance profile is used.
  aws: {
    region: 'us-east-1',
    runningInAws: false,
    accessKeyId: '',
    secretAccessKey: ''
  },
  security: {
    verificationLinkExpiresMinutes: 60,
    rateLimiting: {
      // Account-creation / email endpoints (app.js).
      auth: { windowSeconds: 300, maxAttempts: 10 }
    },
    // Failed-login lockout (DB-backed, table login_lockouts). Tracks both the
    // client IP and the typed account; after maxFailures on either axis it is
    // blocked for lockoutSeconds. A successful login clears both counters.
    loginLockout: { enabled: true, maxFailures: 10, lockoutSeconds: 300 },
    headers: { enabled: true, contentSecurityPolicy: true },
    // secure: leave unset/null to auto-enable the Secure cookie flag under HTTPS.
    session: { secure: null, httpOnly: true, sameSite: 'strict' }
  }
};

function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, source[k]);
    } else if (target[k] === undefined) {
      target[k] = source[k];
    }
  }
  return target;
}

const appConfig = {};

function load() {
  let onDisk = {};
  if (fs.existsSync(configPath)) {
    try { onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch (e) { console.error('[config] Failed to parse config.json:', e.message); }
  } else {
    console.warn('[config] config.json not found — using defaults');
  }
  // Clear and repopulate so the exported reference stays the same object.
  for (const k of Object.keys(appConfig)) delete appConfig[k];
  Object.assign(appConfig, onDisk);
  deepMerge(appConfig, JSON.parse(JSON.stringify(defaults)));
}

function save() {
  // Strip helper fields that start with '_' (comments) before writing back.
  function strip(obj) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const out = {};
      for (const k of Object.keys(obj)) {
        if (k.startsWith('_')) continue;
        out[k] = strip(obj[k]);
      }
      return out;
    }
    return obj;
  }
  fs.writeFileSync(configPath, JSON.stringify(strip(appConfig), null, 2));
}

load();

module.exports = { appConfig, defaults, load, reload: load, save };
