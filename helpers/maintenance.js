// helpers/maintenance.js — full-site maintenance mode.
//
// When scripts/maintenance.sh writes maintenance.json with {"enabled": true},
// this middleware intercepts every request and returns a self-contained 503
// maintenance screen (branded blurred backdrop + centered frosted card with
// the logo, title, and detailed message). API calls get a 503 JSON instead.
// The admin console flips it remotely by running config.maintenanceCommand
// (./scripts/maintenance.sh) in this app's directory.
//
// The logo is optional: drop a PNG at HTML/images/logo.png and it appears on
// the card; without one the card simply shows the title and message.
//
// State is re-read only when maintenance.json's mtime changes, so toggling is
// instant — no server restart required. The logo is inlined as a base64 data
// URI so the page renders even though static asset serving is sealed off.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'maintenance.json');
const LOGO_FILE = path.join(__dirname, '..', 'HTML', 'images', 'logo.png');

// ── state cache (refreshed on file mtime change) ─────────────────────────
let cache = { mtimeMs: -1, state: null };

function readState() {
  let stat;
  try {
    stat = fs.statSync(STATE_FILE);
  } catch {
    // No file → maintenance disabled.
    cache = { mtimeMs: -1, state: null };
    return null;
  }
  if (stat.mtimeMs === cache.mtimeMs) return cache.state;

  let state = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (parsed && parsed.enabled === true) state = parsed;
  } catch {
    // Malformed / empty file = treat as disabled rather than 500 the site —
    // but DON'T cache that verdict: maintenance.sh writes atomically, yet a
    // half-written file by any other means (or a read that raced it) would
    // otherwise be remembered as "disabled" until the mtime changed again.
    return null;
  }
  cache = { mtimeMs: stat.mtimeMs, state };
  return state;
}

// ── logo as a data URI (re-read when the file changes) ───────────────────
// Keyed by mtime: a logo uploaded, replaced or restored (Image Restore,
// Full Restore) shows on the maintenance page without a restart.
let logoCache = { mtimeMs: -1, uri: '' };
function getLogoDataUri() {
  let st;
  try { st = fs.statSync(LOGO_FILE); } catch { logoCache = { mtimeMs: -1, uri: '' }; return ''; }
  if (st.mtimeMs === logoCache.mtimeMs) return logoCache.uri;
  try {
    logoCache = { mtimeMs: st.mtimeMs, uri: 'data:image/png;base64,' + fs.readFileSync(LOGO_FILE).toString('base64') };
  } catch {
    logoCache = { mtimeMs: st.mtimeMs, uri: '' };
  }
  return logoCache.uri;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage(state, appConfig) {
  const appTitle = escapeHtml((appConfig && appConfig.appTitle) || 'Mission Men of Anna');
  const title = escapeHtml(state.title || 'We’ll be right back');
  const message = escapeHtml(
    state.message || 'The site is temporarily down for scheduled maintenance. Please check back shortly.'
  );
  const logo = getLogoDataUri();
  const logoImg = logo
    ? `<img class="m-logo" src="${logo}" alt="${appTitle}">`
    : '';

  // No inline <script> (CSP scriptSrc is 'self' only). Inline styles + data:
  // image are allowed by the site's CSP (styleSrc 'unsafe-inline', imgSrc data:).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${appTitle} — Maintenance</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #11131a;
    background: #0d143a;
  }
  /* Full-screen lock layer — blocks all interaction with anything behind it.
     Uses flex + margin:auto on the card so content centers normally but
     scrolls (instead of clipping) when the viewport is too short. */
  .m-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 24px;
  }
  /* Branded, heavily-blurred backdrop (out-of-focus brand blobs). */
  .m-backdrop {
    position: fixed;
    inset: -10%;
    z-index: -1;
    background:
      radial-gradient(40% 50% at 20% 25%, rgba(59,82,212,.85), transparent 70%),
      radial-gradient(45% 55% at 80% 20%, rgba(44,62,158,.85), transparent 70%),
      radial-gradient(50% 60% at 75% 85%, rgba(30,42,107,.9), transparent 70%),
      radial-gradient(45% 55% at 15% 90%, rgba(59,82,212,.7), transparent 70%),
      #0d143a;
    filter: blur(60px) saturate(1.1);
    transform: scale(1.1);
  }
  /* Centered frosted-glass card, locked in place. */
  .m-card {
    width: min(560px, 100%);
    margin: auto;
    text-align: center;
    padding: 48px 40px 44px;
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.86);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    backdrop-filter: blur(20px) saturate(1.2);
    border: 1px solid rgba(255, 255, 255, 0.6);
    box-shadow: 0 30px 80px rgba(8, 14, 48, 0.45);
  }
  .m-logo {
    width: 132px;
    height: 132px;
    object-fit: contain;
    margin: 0 auto 24px;
    display: block;
  }
  .m-title {
    margin: 0 0 14px;
    font-size: 2rem;
    line-height: 1.15;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #1e2a6b;
  }
  .m-message {
    margin: 0 auto;
    max-width: 42ch;
    font-size: 1.02rem;
    line-height: 1.6;
    color: #3a4154;
  }
  .m-rule {
    width: 56px;
    height: 4px;
    border-radius: 4px;
    background: #3b52d4;
    margin: 22px auto;
    opacity: .85;
  }
  @media (max-width: 520px) {
    .m-card { padding: 36px 24px 32px; }
    .m-title { font-size: 1.6rem; }
    .m-logo { width: 108px; height: 108px; }
    .m-message { font-size: 0.96rem; }
  }
</style>
</head>
<body>
  <div class="m-backdrop"></div>
  <div class="m-overlay">
    <div class="m-card" role="alertdialog" aria-labelledby="m-title" aria-describedby="m-message">
      ${logoImg}
      <h1 class="m-title" id="m-title">${title}</h1>
      <div class="m-rule"></div>
      <p class="m-message" id="m-message">${message}</p>
    </div>
  </div>
</body>
</html>`;
}

// Express middleware factory. Mount BEFORE static/routes so it intercepts the
// whole site. Returns a no-op pass-through whenever maintenance is disabled.
module.exports = function maintenanceMiddleware(appConfig) {
  return function (req, res, next) {
    const state = readState();
    if (!state) return next();

    res.set('Retry-After', '3600');
    res.set('Cache-Control', 'no-store');

    // API → machine-readable 503 so the SPA / integrations can react.
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      return res.status(503).json({
        error: 'maintenance',
        title: state.title || null,
        message: state.message || null
      });
    }

    // Everything else → the full-screen maintenance page.
    return res.status(503).type('html').send(renderPage(state, appConfig));
  };
};
