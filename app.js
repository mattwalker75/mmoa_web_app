// app.js — entry point for the mmoa_web_app (Mission Men of Anna website).
//
// Same wiring style as car_show_control_plane/app.js:
//   1. Load config and create DB connection.
//   2. Apply security headers, logging, body parsing, input-length cap.
//   3. Mount the JSON API (site content, events, raffles, board, the "Need
//      Help?" directory, nonprofit auth + portal) at /api.
//   4. Serve the admin-editable website images from HTML/images/ and the
//      uploaded images from uploads/.
//   5. Serve the Angular build from frontend/mmoa-web-ui/dist when present
//      (with Open Graph tags injected on /events/:slug and /raffles/:slug;
//      /need-help/preview/:id is the console's org preview).
//
// There is deliberately NO admin surface here: nonprofits, events, raffles,
// website content and settings are all managed from the separate
// mmoa_admin_console,
// which edits this app's files and database directly. This app also never
// creates or modifies AWS resources — its only (optional) AWS use is sending
// email through SES.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const orgMetrics = require('./helpers/orgMetrics');

const { appConfig } = require('./config/appConfig');
const { init: initDb } = require('./db/database');
const { enforceInputLimits } = require('./middleware/inputLimits');

const db = initDb(appConfig);

const app = express();

// ── trust proxy (for X-Forwarded-For when behind an ALB / nginx) ────────
if (appConfig.server && appConfig.server.trustProxy) {
  app.set('trust proxy', appConfig.server.trustProxy === true ? 1 : appConfig.server.trustProxy);
}

// ── www → apex redirect ─────────────────────────────────────────────────
// The canonical origin is publicBaseUrl (the bare apex). Session cookies are
// host-only, so a login started on www.<apex> would not survive a later link
// (e.g. a verification email) that lands on the apex. Cheapest cure: never
// let a session start on www — bounce it to the apex immediately, keeping
// path + query. 301 for GET/HEAD; 308 preserves the method for anything else.
// Runs first (right after trust proxy so req.hostname reads X-Forwarded-Host
// correctly behind the ALB); skipped when publicBaseUrl isn't set.
{
  let apexHost = '';
  try { apexHost = new URL(appConfig.publicBaseUrl || '').hostname; } catch (e) { /* no canonical host */ }
  if (apexHost) {
    app.use((req, res, next) => {
      if (req.hostname === `www.${apexHost}`) {
        const code = (req.method === 'GET' || req.method === 'HEAD') ? 301 : 308;
        return res.redirect(code, `https://${apexHost}${req.originalUrl}`);
      }
      next();
    });
  }
}

// ── security headers ───────────────────────────────────────────────────
// Is the site reached over HTTPS — served directly (server.ssl) or behind a
// TLS-terminating proxy (publicBaseUrl https)? Helmet's defaults add HSTS and
// the CSP `upgrade-insecure-requests` directive, which make the browser
// rewrite every request — scripts, styles, even redirects — to https://. On a
// plain-HTTP origin (local dev, the HTTP-only ALB) nothing answers there, so
// the SPA never loads (white screen). Send both only when HTTPS is real.
const serveHttps = !!(appConfig.server && appConfig.server.ssl) ||
  /^https:\/\//i.test(appConfig.publicBaseUrl || '');
if (appConfig.security && appConfig.security.headers && appConfig.security.headers.enabled !== false) {
  app.use(helmet({
    strictTransportSecurity: serveHttps,
    contentSecurityPolicy: appConfig.security.headers.contentSecurityPolicy === false ? false : {
      directives: {
        defaultSrc: ["'self'"],
        // scriptSrc stays 'self' only (no 'unsafe-inline') — this is the
        // directive that actually blocks injected-script XSS.
        scriptSrc: ["'self'"],
        // styleSrc must keep 'unsafe-inline': Angular injects component styles
        // as inline <style> tags and templates use inline style attributes, so
        // removing it would break the UI. Inline styles are not a script-exec
        // vector, so this is a much smaller concern than inline scripts.
        // fonts.googleapis.com serves the Saira Condensed / Barlow stylesheet
        // linked from index.html; the font files come from fonts.gstatic.com.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        // Allow remote imagery (photos linked from the website content),
        // data: URIs, and blob: (the portal previews a resized photo before
        // uploading it) in addition to same-origin assets.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        // Hardening that doesn't break anything: no plugins/objects, lock the
        // <base> tag to same-origin, and forbid being framed (clickjacking).
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        // null removes helmet's default directive (see serveHttps above).
        upgradeInsecureRequests: serveHttps ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  }));
}

app.use(compression());

// ── health check (ALB target-group probe) ────────────────────────────────
// Mounted BEFORE morgan so the every-30s probe doesn't flood the logs, and
// before sessions / rate-limit / maintenance so it is never blocked, throttled,
// or served the maintenance page. Liveness only: returns 200 without touching
// the DB, so a briefly-busy database can't flap the target out of service.
// The ALB target group in mmoa_web_app_infra (e_ALB_mmoa.yaml,
// HealthCheckPath) probes this path.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'web-app', uptime: process.uptime() });
});

// morgan's stock formats log the full URL, query string included — which
// would write the console's ?preview=<token> links (and whatever a visitor
// types) into logs/app.log. Log the path only. (START_APP.sh rotates the log
// file by size before each launch.)
morgan.token('path', (req) => {
  const u = req.originalUrl || req.url || '';
  const q = u.indexOf('?');
  return q === -1 ? u : u.slice(0, q);
});
app.use(morgan(':method :path :status :res[content-length] - :response-time ms')); // = 'tiny' with :url → :path

// ── sessions ───────────────────────────────────────────────────────────
// Signing keys come from config.json when real values are set there;
// otherwise from local-secrets.json (config/localSecrets.js), generated once
// on first boot and reused on every restart — so sessions survive restarts
// and a multi-process deployment shares keys — WITHOUT rewriting config.json.
const localSecrets = require('./config/localSecrets');
const { keys: sessionKeys, source: sessionKeySource } = localSecrets.sessionKeys(appConfig);
console.log(`[session] signing keys from ${sessionKeySource}`);

const sessionSecCfg = (appConfig.security && appConfig.security.session) || {};
// secure cookie: honor an explicit true/false; otherwise auto-enable whenever
// the site is served over HTTPS (serveHttps, defined with the security
// headers above) — so a production HTTPS deploy gets a Secure cookie even if
// the flag was left unset.
const secureCookie = sessionSecCfg.secure === true ? true
  : sessionSecCfg.secure === false ? false
  : serveHttps;
app.use(cookieSession({
  name: 'mw_session',
  keys: sessionKeys,
  maxAge: (appConfig.sessionMaxAgeHours || 8) * 60 * 60 * 1000,
  httpOnly: sessionSecCfg.httpOnly !== false,
  secure: secureCookie,
  sameSite: sessionSecCfg.sameSite || 'strict'
}));

// ── body parsers ───────────────────────────────────────────────────────
// 16 KB everywhere except the nonprofit portal's profile save (description,
// hours, what-to-bring and up to 10 contacts — still tiny, but can pass
// 16 KB), which gets 64 KB. Mounted first, so the general parser below sees
// the body as already parsed. Every field is also length-capped
// individually below. (Photo uploads are multipart, parsed by multer in
// routes/portal.js with their own uploads.maxMb cap.)
app.use('/api/portal', express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(express.json({ limit: '16kb' }));

// ── per-field length cap ───────────────────────────────────────────────
app.use(enforceInputLimits);

// ── rate-limit auth endpoints ──────────────────────────────────────────
// Coarse per-IP window over the account-creation / email / password endpoints. Login is
// deliberately excluded here: it has a dedicated failed-attempt lockout
// (middleware/loginLockout.js) that counts only failures and resets on a
// successful sign-in, which a blanket request limiter can't express.
const authRl = appConfig.security && appConfig.security.rateLimiting && appConfig.security.rateLimiting.auth;
if (authRl) {
  const authLimiter = rateLimit({
    windowMs: (authRl.windowSeconds || 300) * 1000,
    max: authRl.maxAttempts || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a few minutes and try again.' }
  });
  // change-password also has the account lockout (wrong current password
  // counts like a failed login); the IP window here caps raw volume.
  app.use(['/api/auth/signup', '/api/auth/forgot-password', '/api/auth/resend-verification', '/api/auth/reset-password/check', '/api/auth/change-password'], authLimiter);
}

// ── maintenance mode ─────────────────────────────────────────────────────
// Toggled by scripts/maintenance.sh (writes maintenance.json) — which the
// admin console runs remotely via config.maintenanceCommand. When enabled,
// every request below this point is intercepted with a 503 maintenance screen
// (HTML for navigations, JSON for /api). Reads state live on each request, so
// enabling/disabling needs no restart.
app.use(require('./helpers/maintenance')(appConfig));

// ── editable website images (the admin console drops files in HTML/images/) ─
app.use('/content/images', express.static(path.join(__dirname, 'HTML', 'images'), { maxAge: '1h', index: false }));

// ── uploaded images (uploads/{events,raffles,orgs,board}/) ──────────────
// Written by the portal (orgs) and the admin console (events, raffles,
// board). Read-only here: no directory index, dotfiles (temp files) refused,
// 1 h cache. Names are random, so a replaced image gets a new URL.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1h', index: false, dotfiles: 'deny', redirect: false
}));
// A miss under either image path is a plain 404 — never the SPA's index.html
// (which the final handler would otherwise send with a 200).
app.use(['/uploads', '/content/images'], (req, res) => res.status(404).type('text').send('Not found'));

// ── JSON API (Angular SPA backend) ───────────────────────────────────────
app.use('/api', require('./routes/api')(db, appConfig));

// ── Angular SPA ──────────────────────────────────────────────────────────
// Production build output from `ng build` (the @angular/build:application
// builder emits a browser/ subfolder). Served at the root with a history-API
// fallback so client-side routes (/events/…, /need-help, /portal, …) resolve to
// index.html. /api is matched above, so it never reaches here.
const spaDir = path.join(__dirname, 'frontend', 'mmoa-web-ui', 'dist', 'mmoa-web-ui', 'browser');
const spaIndex = path.join(spaDir, 'index.html');
const spaBuilt = fs.existsSync(spaIndex);
if (spaBuilt) {
  app.use(express.static(spaDir, { maxAge: '1h', index: false }));
} else {
  console.warn('[spa] Angular build not found at', spaDir, '— run `npm run build:frontend`. Serving a placeholder.');
}

// ── Open Graph tags for shared event / raffle links ──────────────────────
// Facebook's crawler doesn't run JavaScript, so a shared /events/<slug> link
// would preview as the bare site. For these two routes the server injects
// <title> + og:/twitter: tags (title, summary, flyer image) into index.html
// before sending it; the SPA then boots as usual. Unknown / unpublished slugs
// get the plain index with a 404 status (the SPA shows its not-found view).
if (spaBuilt) {
  const { injectOgMeta } = require('./helpers/ogMeta');
  const publicApi = require('./routes/public')(db, appConfig);
  let indexCache = { mtimeMs: -1, html: '' };
  const readIndex = () => {
    const st = fs.statSync(spaIndex);
    if (st.mtimeMs !== indexCache.mtimeMs) indexCache = { mtimeMs: st.mtimeMs, html: fs.readFileSync(spaIndex, 'utf8') };
    return indexCache.html;
  };
  const absBase = () => (appConfig.publicBaseUrl || `http://localhost:${appConfig.port || 3004}`).replace(/\/+$/, '');
  const siteName = () => appConfig.appTitle || 'Mission Men of Anna';

  // The tag injection itself lives in helpers/ogMeta.js (pure, unit-tested —
  // DB text can contain `$'` and friends, which String.replace treats as
  // patterns unless the replacement is a function).
  function sendWithMeta(res, meta) {
    const html = readIndex();
    if (!meta) return res.status(404).type('html').send(html);
    res.set('Cache-Control', 'no-cache').type('html')
      .send(injectOgMeta(html, meta, { siteName: siteName(), absBase: absBase() }));
  }

  // An admin's preview link (?preview=<token> from the console, ~30 min):
  // the console shows it in a framed pop-up on ITS origin, so only this
  // response may be framed by another site. That's safe because the page is
  // read-only and needs a fresh token only console admins get. Never indexed
  // or cached.
  function sendPreview(res) {
    const csp = res.getHeader('Content-Security-Policy');
    if (csp) res.setHeader('Content-Security-Policy', String(csp).replace(/frame-ancestors [^;]*/, 'frame-ancestors *'));
    res.removeHeader('X-Frame-Options');
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }).type('html').send(readIndex());
  }

  const defaultImage = '/content/images/carshow.jpg';
  app.get('/events/:slug', async (req, res, next) => {
    try {
      const ev = await publicApi.findPublishedEvent(req.params.slug, req.query.preview);
      if (ev && ev.preview) return sendPreview(res);
      sendWithMeta(res, ev && {
        title: ev.title,
        description: ev.summary || ev.benefiting || '',
        path: '/events/' + ev.slug,
        image: ev.flyer_url || ev.cover_url || defaultImage
      });
    } catch (e) { next(e); }
  });
  app.get('/raffles/:slug', async (req, res, next) => {
    try {
      const r = await publicApi.findPublishedRaffle(req.params.slug, req.query.preview);
      if (r && r.preview) return sendPreview(res);
      sendWithMeta(res, r && {
        title: r.title,
        description: [r.ticket_price_text, r.drawing_at ? 'Drawing ' + new Date(r.drawing_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' }) : '']
          .filter(Boolean).join(' · ') || 'Raffle tickets sold in person by Mission Men of Anna',
        path: '/raffles/' + r.slug,
        image: r.image_url || r.flyer_url || defaultImage
      });
    } catch (e) { next(e); }
  });
  // The console's Preview of a nonprofit profile (any status). No Open Graph
  // here: the page is never shared. Without a valid token the plain index is
  // served and the SPA page says the link has expired.
  app.get('/need-help/preview/:id', async (req, res, next) => {
    try {
      const found = req.query.preview && await publicApi.findDirectoryOrg(Number(req.params.id), req.query.preview);
      if (found && found.preview) return sendPreview(res);
      next();
    } catch (e) { next(e); }
  });
}

// Final handler: JSON 404 for unmatched API routes, SPA index for everything
// else (GET), so deep links into the Angular app work on refresh.
app.use((req, res) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (req.method !== 'GET') return res.status(404).send('Not found');
  if (spaBuilt) return res.sendFile(spaIndex);
  res.status(503).send(`<!DOCTYPE html><html><head><title>${require('./views/escapeHtml').escapeHtml(appConfig.appTitle || 'Mission Men of Anna')}</title></head>
    <body style="font-family:sans-serif;max-width:640px;margin:80px auto;padding:0 24px;">
    <h2>Frontend not built yet</h2>
    <p>The Angular client hasn't been built. From the project root run:</p>
    <pre style="background:#f4f4f5;padding:14px;border-radius:8px;">npm run build:frontend</pre>
    <p>then restart the server. The JSON API at <code>/api</code> is already live.</p>
    </body></html>`);
});

// ── Error handler (last) ─────────────────────────────────────────────────
// Anything that throws or calls next(err) — a malformed JSON body (400), a
// body over the parser limit (413), a DB error on the OG routes — ends here.
// Without this, Express's default handler sends the error's stack trace as
// an HTML page whenever NODE_ENV isn't 'production'. Logs method + path; the
// response carries only the status and a generic message — never err.stack,
// err.message or a file path. JSON for /api and for callers that accept JSON,
// a bare HTML page otherwise. (Four parameters: that is how Express tells an
// error handler from ordinary middleware.)
app.use((err, req, res, next) => {
  const status = Number.isInteger(err && err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, (err && err.stack) || err);
  else console.warn(`[error] ${req.method} ${req.path}: ${status} ${(err && err.type) || (err && err.message) || ''}`);
  if (res.headersSent) return res.end();
  const message = status === 400 ? 'Bad request'
    : status === 413 ? 'Request body too large'
    : status === 415 ? 'Unsupported content type'
    : status < 500 ? 'Request could not be processed'
    : 'Something went wrong. Please try again.';
  const wantsJson = req.path === '/api' || req.path.startsWith('/api/') ||
    (req.get('accept') || '').includes('application/json') ||
    (req.get('content-type') || '').includes('application/json');
  if (wantsJson) return res.status(status).json({ error: message });
  res.status(status).type('html').send(`<!DOCTYPE html><html><head><title>${status}</title></head>` +
    `<body style="font-family:system-ui;padding:24px;max-width:520px;margin:auto;">` +
    `<h2>${status}</h2><p>${message}</p><p><a href="/">Back to the site</a></p></body></html>`);
});

// ── boot ───────────────────────────────────────────────────────────────
const port = appConfig.port || 3004;
const useSsl = !!(appConfig.server && appConfig.server.ssl);

// When SSL is enabled, keyPath and certPath must both point to readable
// files. Refuse to start (rather than silently downgrading to HTTP) so a
// misconfigured TLS deployment fails loudly instead of serving plaintext.
if (useSsl) {
  const { keyPath, certPath } = appConfig.server;
  const errors = [];
  if (!keyPath) {
    errors.push('server.keyPath is not set');
  } else if (!fs.existsSync(keyPath)) {
    errors.push(`server.keyPath does not point to an existing file: ${keyPath}`);
  }
  if (!certPath) {
    errors.push('server.certPath is not set');
  } else if (!fs.existsSync(certPath)) {
    errors.push(`server.certPath does not point to an existing file: ${certPath}`);
  }
  if (errors.length) {
    console.error('[boot] SSL is enabled (server.ssl=true) but the configuration is invalid:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('[boot] Fix config.json (set valid keyPath/certPath, or set server.ssl=false). Refusing to start.');
    process.exit(1);
  }
}

// publicBaseUrl is baked into the verification / password-reset links. If it
// disagrees with the actual scheme the server listens on, those links are
// dead (an http:// link can't reach an https-only port). Warn loudly.
const wantHttps = useSsl;
const baseIsHttps = /^https:\/\//i.test(appConfig.publicBaseUrl || '');
if (wantHttps && !baseIsHttps) {
  console.warn(`[boot] WARNING: server.ssl=true but publicBaseUrl is "${appConfig.publicBaseUrl}". Emailed verification/reset links will point at http:// and fail to load. Set publicBaseUrl to https://…`);
} else if (!wantHttps && baseIsHttps) {
  // (Expected behind the ALB, which terminates TLS and forwards plain HTTP —
  // the links are correct there; this matters only when nothing fronts the app.)
  console.warn(`[boot] WARNING: server.ssl=false but publicBaseUrl is "${appConfig.publicBaseUrl}". Emailed links will point at https:// but the server only serves http:// (fine behind a TLS-terminating ALB).`);
}
// A localhost base URL must also carry this server's port, or every emailed
// link points at :443/:80 where nothing is listening. (Behind the production
// ALB the host is the apex on 443, so this only speaks up for local hosts.)
try {
  const u = new URL(appConfig.publicBaseUrl || '');
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname);
  const basePort = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (isLocal && basePort !== Number(port)) {
    console.warn(`[boot] WARNING: publicBaseUrl "${appConfig.publicBaseUrl}" points at port ${basePort} but this server listens on ${port}. Emailed links will not reach it — use ${u.protocol}//${u.hostname}:${port}.`);
  }
} catch (e) { /* unparseable publicBaseUrl is warned about elsewhere */ }

// TESTING / TEMPORARY: email.showLinksInBrowser hands verification and reset
// links straight back to the browser (see routes/api.js). That means anyone
// can verify any address they type and reset the password of any account
// whose email they know — fine while email isn't set up, never fine in a
// real launch. Make it impossible to miss in the log.
if (appConfig.email && appConfig.email.showLinksInBrowser === true) {
  console.warn('[boot] ************************************************************************');
  console.warn('[boot] WARNING: email.showLinksInBrowser = true (TESTING / TEMPORARY).');
  console.warn('[boot] Verification and password-reset links are returned to the browser, so');
  console.warn('[boot] anyone who knows an email address can verify it or reset its password.');
  console.warn('[boot] Turn it off (Admin Console → Web App Settings → Email) once email works.');
  console.warn('[boot] ************************************************************************');
}

let server;
if (useSsl) {
  const opts = {
    key: fs.readFileSync(appConfig.server.keyPath),
    cert: fs.readFileSync(appConfig.server.certPath)
  };
  server = https.createServer(opts, app);
} else {
  server = http.createServer(app);
}

server.listen(port, () => {
  const scheme = useSsl ? 'https' : 'http';
  console.log(`[boot] Web App listening on ${scheme}://localhost:${port}`);

  // ── login-lockout housekeeping ─────────────────────────────────────────
  // Prune resolved brute-force rows (no standing failures, lock expired) so
  // the login_lockouts table doesn't grow unbounded.
  const loginLockout = require('./middleware/loginLockout');
  setInterval(() => loginLockout.cleanup(db, appConfig).catch(e => console.error('[security] lockout cleanup failed:', e.message)), 15 * 60 * 1000).unref();

  // ── token pruning ──────────────────────────────────────────────────────
  // Consumed or long-expired verification + reset tokens serve no purpose
  // after a week. Without this the tables only ever grow.
  const sqlTime = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\..+/, '');
  async function pruneTokens() {
    const weekAgo = sqlTime(Date.now() - 7 * 86400 * 1000);
    for (const t of ['email_verification_tokens', 'password_reset_tokens']) {
      await db.runAsync(`DELETE FROM ${t} WHERE (consumed_at IS NOT NULL AND consumed_at < ?) OR expires_at < ?`, [weekAgo, weekAgo]);
    }
  }
  setInterval(() => pruneTokens().catch(e => console.error('[db] token pruning failed:', e.message)), 15 * 60 * 1000).unref();

  // ── nonprofit usage counts (helpers/orgMetrics.js) ─────────────────────
  // In-memory counters are written once an hour; once a day hours older
  // than 7 days become day rows, days older than 28 days become week rows,
  // and rows older than 5 years are deleted. Both also run shortly after
  // boot so a restart never skips a day.
  const flushMetrics = () => orgMetrics.flush(db).catch(e => console.error('[metrics] flush failed:', e.message));
  const rollupMetrics = () => orgMetrics.rollup(db)
    .then(r => { if (r.hours || r.days || r.purged) console.log(`[metrics] rollup: ${r.hours} hour rows → days, ${r.days} day rows → weeks, ${r.purged} purged`); })
    .catch(e => console.error('[metrics] rollup failed:', e.message));
  setInterval(flushMetrics, 60 * 60 * 1000).unref();
  setInterval(rollupMetrics, 24 * 60 * 60 * 1000).unref();
  setTimeout(rollupMetrics, 60 * 1000).unref();
});

// ── Crash safety + graceful shutdown ──────────────────────────────────────
// Keep the process alive on a stray promise rejection (log it loudly); drain
// and exit on a truly uncaught exception or a shutdown signal so a supervisor
// (or STOP_APP.sh's SIGTERM) gets a clean exit.
let _shuttingDown = false;
function shutdown(signal, code = 0) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing server`);
  const force = setTimeout(() => { console.error('[shutdown] forced exit after timeout'); process.exit(code); }, 10000);
  // Write the current hour's usage counts first (best effort, bounded by `force`).
  const metricsDone = orgMetrics.flush(db).catch(e => console.error('[metrics] final flush failed:', e.message));
  server.close(() => metricsDone.then(() => { clearTimeout(force); console.log('[shutdown] server closed'); process.exit(code); }));
}
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] UNHANDLED REJECTION (kept alive):', (reason && reason.stack) || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] UNCAUGHT EXCEPTION:', (err && err.stack) || err);
  shutdown('uncaughtException', 1);
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
