# mmoa_web_app

The public website and member accounts for **Mission Men of Anna Inc**, a
501(c)(3) nonprofit men's group in Anna, Texas:

> Our mission is to come together as men in service of those in need by
> organizing events to provide essential resources to support the community
> and the people of Anna.

Visitors read about the mission and upcoming events; members sign up (with
email verification), sign in, and see their profile and upcoming events.

It's an **Express JSON API** with an **Angular single-page app** front end
(`frontend/mmoa-web-ui/`), ported from the car-show control plane. All
administration — members, events, website content, settings, maintenance mode —
lives in the separate **mmoa_admin_console**, which edits this app's files and
database directly. By design, this app exposes no admin surface and never
creates or modifies AWS resources (its only optional AWS use is SES email).

## Prerequisites

- Node.js 20+ and npm
- SQLite (`sqlite3` CLI, for `SETUP_SQLLITE_DB.sh`) — or MySQL/MariaDB

## Quick start (local, SQLite)

```bash
./START_APP.sh            # installs deps + builds the SPA on first run, then starts (port 3004)
./STOP_APP.sh             # stop it
./RESTART_APP.sh          # stop, pause, start
./START_APP.sh --force-rebuild   # after changing dependencies or frontend source
```

The database (`mmoa_web_app.db`) is created automatically on first boot from
`setup_sqlite_db.sql`; `./SETUP_SQLLITE_DB.sh` wipes and rebuilds it. The app
runs detached: logs in `logs/app.log`, PID in `tmp/app.pid`.

Open http://localhost:3004.

Optional, once per clone:

```bash
# an organizer (admin) account — the DB auto-creates on first run
node scripts/create-admin.js admin admin@example.org 'First' 'Last' 'somepassword'

# local git guards that keep real keys out of commits
./scripts/git-hooks/install.sh
```

> While iterating on the UI, run `npm run dev:frontend` (Angular dev server with
> live reload on :4200, proxying `/api` and `/content` to :3004) instead of
> rebuilding each time. See `Docs/development.md`.

## Email isn't set up yet — the testing bypass

The committed `config.json` sets **`email.showLinksInBrowser: true`** (TESTING /
TEMPORARY). Verification and password-reset links are still "sent" through the
configured transport (`console` → printed to `logs/app.log`), **and** returned to
the browser, which shows *"Email isn't set up yet — click here to verify"*. Turn
it off (admin console → Web App Settings → Email) as soon as real email works —
while it is on, anyone who knows an email address can verify it or reset its
password. See `Docs/email.md`.

## Configuration

All runtime settings live in `config.json` (defaults in `config/appConfig.js`).
`config.json` is **tracked** (the infra template clones the repo and seds it) —
keep secrets out of the committed copy. See `Docs/configuration.md`.

## Documentation

| Doc | What it covers |
|---|---|
| [Docs/architecture.md](Docs/architecture.md) | System overview, components, the no-admin-surface principle, the shared DB |
| [Docs/configuration.md](Docs/configuration.md) | Full `config.json` reference + secrets handling |
| [Docs/development.md](Docs/development.md) | Build/run workflow, scripts, the Angular `inlineCritical` gotcha, testing |
| [Docs/database.md](Docs/database.md) | Schema, SQLite vs MySQL, migrations |
| [Docs/email.md](Docs/email.md) | Email transports (console / SMTP / SES), verification, the testing bypass |
| [Docs/website-content.md](Docs/website-content.md) | The admin-editable website (`HTML/` section files, images, tokens, windows) |

## License

Proprietary — © Mission Men of Anna Inc.
