# Development

## Layout

```
app.js                         # Express entry: headers, sessions, API, images, SPA
config.json                    # Runtime config (tracked, scrubbed) — config/appConfig.js loads it
config/appConfig.js            # Defaults for every key + load/save
config/localSecrets.js         # Session keys in local-secrets.json (gitignored)
db/database.js                 # SQLite/MySQL abstraction + boot-time migrations
middleware/                    # auth (bcrypt), inputLimits, loginLockout
helpers/
  email.js                     # outbound email (console/SMTP/SES)
  maintenance.js               # maintenance-mode middleware (reads maintenance.json)
  markdownLite.js              # safe markdown-lite renderer (console keeps a verbatim copy)
  orgs.js                      # directory profile loading + public/private shaping + search text
  formats.js                   # profile field normalizers/validators (SPA mirror: core/formats.ts)
  uploads.js                   # uploads/ image store (magic bytes, random names)
  sqlTime.js                   # UTC timestamp helpers
  tokens.js                    # random tokens
  ogMeta.js                    # Open Graph tags for shared event / raffle links
  orgCache.js                  # short-lived cache of public orgs (directory)
  orgMetrics.js                # anonymous profile usage counts (flush, rollup, purge)
routes/
  api.js                       # /api: auth + mounts the two below
  public.js                    # site sections, events, raffles, board, directory
  portal.js                    # /api/portal: the nonprofit's own profile + photos
test/                          # `npm test` (node --test): markdownLite (+ XSS), ogMeta, orgMetrics, schema parsing, SQLite transaction gate
views/escapeHtml.js            # HTML escaping (leaf module)
scripts/
  create-member.js             # bootstrap a verified nonprofit login (+ its org; --org "<name>"; password via MEMBER_PASSWORD or prompt)
  seed-sample-data.js          # optional "[Sample]" events/raffle/orgs; --remove undoes it
  sample/shotgun.jpg           # photo for the sample raffle only
  maintenance.sh               # --enable/--disable/--status (the console runs this)
  git-hooks/                   # pre-commit secret scan + install.sh
HTML/                          # admin-editable website sections (hero/about/impact/help/partner/footer) + images/ (incl. logo.png)
uploads/                       # uploaded images (gitignored; events/ raffles/ orgs/ board/)
setup_sqlite_db.sql            # SQLite schema (auto-applied on first run)
setup_mysql_db.sql             # MySQL schema
START_APP.sh STOP_APP.sh RESTART_APP.sh SETUP_SQLLITE_DB.sh SETUP_MYSQL_DB.sh
frontend/mmoa-web-ui/          # Angular SPA (the entire UI)
Docs/                          # this documentation
```

### Front end (`frontend/mmoa-web-ui/src/app/`)

```
app.ts / app.config.ts         # root shell + router; app.ts also owns scrolling (below)
core/
  api.service.ts models.ts     # typed API client + shapes
  strings.ts                   # user-facing text in one place (ready for a Spanish copy)
  formats.ts                   # as-you-type formatting/validation; mirrors helpers/formats.js
  site.service.ts              # /api/site: phone, EIN, Facebook, donation link, website sections
layout/                        # site header (incl. optional Donate button) + footer
pages/                         # one component per route (home, events, need-help, portal, …)
shared/
  org-card.component.ts        # a nonprofit as a "Need Help?" search result
  org-view.component.ts        # a nonprofit's full public profile
  profile-preview-dialog…      # portal "Preview Public Profile" popup (uses the two above)
  nonprofit-carousel…          # Home's left → right partner strip (a swipe row on phones)
```

Rules worth knowing:

- **Keep `core/formats.ts` and `helpers/formats.js` in step.** The SPA formats
  while typing; the server has the final say on save.
- **Typed inputs that reformat** (EIN, phones, extensions) use `maskInput()`,
  which writes the cleaned value back into the element — when formatting
  leaves the model unchanged (a letter typed into a phone), Angular wouldn't
  repaint the box otherwise.
- **Scrolling** is handled in `app.ts`, not by the router
  (`scrollPositionRestoration` is off): a new page starts at the top, a
  query-string-only change (Need Help's `?category=&city=&q=` while typing)
  leaves the page where it is, and Back/Forward restores the old position,
  retrying briefly while the page's list loads.
- **Moving content** (the Home strip) pauses on hover / focus, has a Pause
  button, and stays still under `prefers-reduced-motion`. On phones it is
  always a still row you swipe.
- **Phones (≤ 700px) have their own layout; tablets and desktops don't
  change.** All of it is the "Phones" section at the end of `styles.scss`
  plus two helper classes: `.phone-only` (hidden above 700px) and
  `.wide-only` (hidden at 700px and below). On phones:
  - the header is one bar (logo, Need Help? pill, a labeled **Menu** button
    that opens a full-screen list — a modal `<dialog>`);
  - event and raffle cards become compact rows, and the Home raffle card
    drops its photo;
  - the event page puts title, date, place and Register & pay before the
    flyer (which becomes a "View the flyer" card), and pins a slim Register
    bar to the bottom once the registration band scrolls away;
  - Need Help opens with a pop-up of 911 / 988 / 211 (once per visit,
    `sessionStorage` key `mmoa.needHelp.sosShown`; a red link under the
    intro reopens it) instead of the red strip, and shows the first eight
    needs until **More needs** is opened;
  - the footer shows the emergency numbers as three tap-to-call buttons.

  When changing a page, check it at 390px as well as desktop. Approved
  mockups: https://claude.ai/artifact/GD4c9awdS4UoP6HvGfZrCW

## Lifecycle scripts

| Script | Behavior |
|---|---|
| `./START_APP.sh` | `cd`s to the repo; `npm install` if `node_modules/` is missing; `npm run build:frontend` if `frontend/mmoa-web-ui/dist` is missing; refuses to start a second copy; runs a dependency check (`npm audit --omit=dev --audit-level=high`, 30 s timeout, WARNING block on findings, skipped when offline — never blocks); if the prebuilt `sqlite3` driver won't load (e.g. glibc too old on Amazon Linux 2023) it compiles it from source, logging to `logs/sqlite3-build.log`; rotates `logs/app.log` to `app.log.1` once it passes 50 MB; defaults `NODE_ENV=production`; launches `nohup node app.js >> logs/app.log 2>&1 &`, writes `tmp/app.pid`, and verifies the process stayed up. A PID file is only trusted if that PID is really `node … app.js` (a recycled PID is ignored). `--force-rebuild` reinstalls + rebuilds first. |
| `./STOP_APP.sh` | Stops this install's app only: the PID in `tmp/app.pid` and any `node app.js` on the configured port whose working directory is this folder — anything else on that port is left alone. SIGTERM, up to 10 s grace, then SIGKILL; a stale PID file is removed. Exit 0 if already stopped. |
| `./RESTART_APP.sh` | STOP, 2 s pause, START (options forwarded to START). |
| `./SETUP_SQLLITE_DB.sh` | Deletes and rebuilds `mmoa_web_app.db` from `setup_sqlite_db.sql`. |
| `./SETUP_MYSQL_DB.sh` | Drops + recreates the MySQL database and user from `config.json`, loads `setup_mysql_db.sql`. |

## Two ways to run the front end

The Express server serves the **built** Angular output from
`frontend/mmoa-web-ui/dist/mmoa-web-ui/browser`. So:

- **Iterating on the UI:** `npm run dev:frontend` (Angular dev server on :4200,
  live reload; `/api`, `/content` and `/uploads` are proxied to :3004 — keep the backend
  running).
- **Prod-like:** `npm run build:frontend` (or `./START_APP.sh --force-rebuild`),
  then restart and reload the browser.

| You changed… | What's needed |
|---|---|
| Angular template / component / SCSS | rebuild (or automatic under `ng serve`) |
| `package.json` dependencies | `npm install`, then build |
| server code (`app.js`, `routes/`, `helpers/`) | restart |
| `config.json` | restart |
| `HTML/*` (website content) | nothing — picked up on the next page load |

## ⚠️ The critical-CSS gotcha (important)

Angular's production build defaults to **inlining critical CSS** and loading the
full stylesheet via a `media="print"` + `onload` swap. That swap is an inline
event handler, which this app's CSP (`script-src 'self'`) blocks — and in
headless screenshots it may not fire at all — so class-based styles would never
apply. `frontend/mmoa-web-ui/angular.json` sets
`optimization.styles.inlineCritical = false`, so the stylesheet is
render-blocking and reliable. **Keep it off.**

`app.js` serves static assets with `maxAge: '1h'`; production builds are
content-hashed so this is safe, but hard-reload if a CSS change doesn't show.

## Testing

- **Email in dev:** `email.transport: "console"` prints messages (and links) to
  `logs/app.log`. With `email.showLinksInBrowser: true` the SPA also shows the
  link on screen, so signup → verify → sign in and forgot → reset can be
  completed in the browser alone.
- **curl:** the JSON API takes `Content-Type: application/json`; keep a cookie
  jar (`-c jar -b jar`) for signed-in calls. `trustProxy: 1` means a test can
  vary `X-Forwarded-For` to exercise the per-IP lockout / rate limits without
  locking out its own address.
- **Maintenance:** `./scripts/maintenance.sh --enable --title "…" --message "…"`
  → `/` and `/api/*` answer 503 (`/health` stays 200); `--disable` restores.

## Tests and sample data

- `npm run audit` — `npm audit --omit=dev`: known vulnerabilities in the
  production dependencies, all severities. `START_APP.sh` runs the
  high/critical-only version at every boot and prints a WARNING block (the app
  still starts); run this one by hand now and then, and `npm audit fix --omit=dev`
  (then `npm test` + a restart) to update.
- `npm test` — unit tests (Node's built-in runner, `test/*.test.js`): the
  markdown-lite renderer including XSS strings (`<script>`, `javascript:` /
  `data:` links, attribute break-outs); Open Graph tag building; usage
  metrics (flush, a failed flush keeping its counts, hour → day → week
  rollup, the 30-day window, summary shape); setup-file parsing for the boot
  migrations; and the SQLite transaction gate.
- `node scripts/seed-sample-data.js` — fills an empty site with clearly
  labelled **[Sample]** content: 3 verified nonprofits (logins `sample-org-1..3`
  with unusable random passwords), an upcoming 3rd Annual Coyote Cruisers Car &
  Bike Show and a Chili Cook-Off, and an open shotgun raffle (photo from
  `scripts/sample/shotgun.jpg`). Idempotent. `--remove` deletes exactly what it
  created, including the copied image files. Never run automatically.
- Manual directory check: sign up through the site (the devLink bypass verifies
  the email), fill out the portal, then flip the org live with
  `sqlite3 mmoa_web_app.db "UPDATE organizations SET verification_status='verified' WHERE org_id=1"`
  (the console's Nonprofits page does this for real).
