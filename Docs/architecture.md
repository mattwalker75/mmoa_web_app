# Architecture

## What it is

`mmoa_web_app` is the **public-facing** half of the Mission Men of Anna site.
Visitors read the mission and upcoming events; members sign up, verify their
email, sign in, and see a simple member home (profile, change password,
upcoming events). It is a port of the car-show control plane with the
car-show-only domain (deployments, AWS provisioning, payments, reviews,
subdomains) removed.

## Components

```
┌─────────────────────────────┐          ┌──────────────────────────────┐
│ Angular SPA                 │  HTTPS   │ Express server (app.js)      │
│ frontend/mmoa-web-ui/       │ ───────▶ │  /health   liveness          │
│ (home, events, signup,      │  /api    │  /api/*    JSON API          │
│  login, member home)        │ ◀─────── │  /content/images/*           │
└─────────────────────────────┘          │  serves the built SPA        │
                                         │  helpers/email (console/     │──▶ SMTP / AWS SES
                                         │   SMTP/SES, outbound only)   │
                                         └───────────────┬──────────────┘
                                                         │
                                       mmoa_web_app.db (SQLite) or MySQL
                                       HTML/ (website content), config.json,
                                       maintenance.json, logs/app.log
                                                         │  (shared)
                                         ┌───────────────┴──────────────┐
                                         │ mmoa_admin_console           │
                                         │ (separate repo; local files, │
                                         │  SSH, or AWS SSM)            │
                                         └──────────────────────────────┘
```

- **Angular SPA** (`frontend/mmoa-web-ui/`) — the entire UI. Built with
  `ng build`; the Express server serves the compiled output
  (`dist/mmoa-web-ui/browser`) and falls back to `index.html` for client-side
  routes.
- **Express server** (`app.js`) — security headers, sessions (`mw_session`),
  rate limiting, the maintenance-mode gate, the JSON API at `/api`
  (`routes/api.js`), website images at `/content/images`, and the SPA.
- **Email** (`helpers/email.js`) — outbound-only, console/SMTP/SES. See [email.md](email.md).
- **Database** (`db/database.js`) — a thin dual-engine (SQLite/MySQL) wrapper
  exposing `getAsync` / `allAsync` / `runAsync` / `transaction`. See [database.md](database.md).
- **Maintenance mode** (`helpers/maintenance.js` + `scripts/maintenance.sh` +
  `maintenance.json`) — a live 503 screen for the whole site, toggled without a
  restart.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness only (outside `/api`, before logging/sessions/maintenance). `{status:'ok', service:'web-app', uptime}` |
| GET | `/api/public/config` | `appTitle`, `appSubtitle`, `orgName`, `allowMemberRegistration`, `passwordMinLength`, `showLinksInBrowser` |
| GET | `/api/content` | `{ sections: {hero, mission, events, involved, footer}, windows: {…} }` — see [website-content.md](website-content.md) |
| GET | `/api/events` | Published events: upcoming (soonest first), then up to 20 past (newest first); `upcomingCount` |
| POST | `/api/auth/signup` | Creates a `member`, emails a verification link (`devLink` too when the bypass is on) |
| POST | `/api/auth/login` | `identifier` (login name or email) + `password`; lockout + DUMMY_HASH timing |
| POST | `/api/auth/logout` | Clears the session |
| GET | `/api/auth/me` | Current user or `null` (re-reads the row) |
| POST | `/api/auth/change-password` | Signed in; needs the current password; signs out other sessions |
| POST | `/api/auth/verify` | Consumes a verification token |
| POST | `/api/auth/resend-verification` | Always `ok` (no enumeration) |
| POST | `/api/auth/forgot-password` | Always `ok`; single-use reset link |
| POST | `/api/auth/reset-password/check` | Non-consuming: `ok` or `expired` / `used` / `superseded` / `invalid` |
| POST | `/api/auth/reset-password` | Consumes the token + sets the password in one transaction |

Security behavior carried over from the control plane: a dummy bcrypt compare
for unknown accounts (no timing oracle), the per-IP + per-account login lockout
(`login_lockouts`), per-IP rate limits on the signup/email endpoints, every
authenticated call re-reading the user (deactivated / deleted / password
changed elsewhere → session dropped), and single-use tokens whose expiry is
parsed engine-agnostically and fails closed.

## The no-admin-surface principle

**This app exposes no administrative capability.** There are no admin pages,
no admin API, and no user-management endpoints; the `admin` role only exempts
an organizer account from the email gate. Everything administrative happens in
**mmoa_admin_console**, which reaches this app's directory (locally, over SSH,
or through AWS SSM) and:

- edits `config.json`, `HTML/*.html`, `HTML/windows.json` and `HTML/images/`;
- reads `logs/app.log`;
- runs `config.maintenanceCommand` (`./scripts/maintenance.sh`) and the
  `START_APP.sh` / `STOP_APP.sh` / `RESTART_APP.sh` scripts;
- reads and writes the database (`mmoa_web_app.db` or MySQL).

Those paths are a contract with the console — don't rename them.

In production the app runs on a private subnet behind an ALB
(`mmoa_web_app_infra`), as OS user `mmoa` in `/home/mmoa/mmoa_web_app`.
Compromising the public app yields no admin power and no AWS access beyond
(optionally) sending email.

## Shared database

The database is **shared** with the admin console. Keep schema changes
**additive**, update both `setup_*.sql` files, and coordinate with the console
(its Data Browser reads the live schema, so new tables/columns show up there
automatically). Passwords must hash identically in both apps (bcrypt, cost 10).
