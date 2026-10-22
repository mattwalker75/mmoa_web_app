# mmoa_web_app

The public website for **Mission Men of Anna Inc** (MMoA), a 501(c)(3)
nonprofit men's group in Anna, Texas (EIN 33-4035685):

> Our mission is to come together as men in service of those in need by
> organizing events to provide essential resources to support the community
> and the people of Anna.

The site is the **source of truth for MMoA's events and raffles** (Facebook just
shares the links):

- **Events** — upcoming/past, detail pages with flyer viewer, maps, calendar
  links, registration (e.g. Stripe Payment Link), beneficiaries, share buttons
  and Open Graph tags so Facebook previews show the flyer.
- **Raffles** — prize photos, ticket info, claim rules; tickets are sold in
  person only; the winning ticket is posted after the drawing.
- **Home** — hero, the next 3 events, the current raffle, and a sliding strip
  of the partner nonprofits (left → right, pausable).
- **About** (story, values, board, impact) and **Partner With Us**.
- **"Need Help?"** — anyone can search verified local nonprofits by one or
  more needs, a city and a keyword that filters as you type (no account,
  nothing saved), with 911 / 988 / 211 always shown.
- **Nonprofit portal** — logins exist only for other nonprofits. They sign up
  with their EIN, verify their email, and maintain their directory profile
  (services, cities, what to bring, contacts with optional phone extensions,
  up to 5 captioned photos, private search keywords, per-field
  Public/Hidden). Fields are formatted and checked as they type (EIN, state,
  phone, email, links), and **Preview Public Profile** shows exactly what the
  public sees. MMoA verifies them in the admin console before they appear.
- **Donate** — an optional header button that opens a donation payment link,
  switched on and off from the admin console.

It's an **Express JSON API** with an **Angular single-page app** front end
(`frontend/mmoa-web-ui/`), ported from the car-show control plane. All
administration — nonprofit verification, events, raffles, board, categories &
cities, website content, settings, maintenance mode — lives in the separate
**mmoa_admin_console**, which edits this app's files and
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
`setup_sqlite_db.sql` (schema + reference seeds: service categories, cities,
board roles); `./SETUP_SQLLITE_DB.sh` wipes and rebuilds it. An older DB gains
the new tables automatically on boot. The app runs detached: logs in
`logs/app.log`, PID in `tmp/app.pid`. Uploaded images go to `uploads/`
(gitignored).

Open http://localhost:3004.

Optional, once per clone:

```bash
# (optional) a ready-to-use nonprofit login (email already verified; org unverified)
node scripts/create-member.js pantry pantry@example.org 'First' 'Last' 'somepassword' --org "Anna Food Pantry"

# (optional) demo content, clearly labelled [Sample]; undo with --remove
node scripts/seed-sample-data.js

# unit tests (markdown-lite renderer + XSS cases)
npm test

# local git guards that keep real keys out of commits
./scripts/git-hooks/install.sh
```

> While iterating on the UI, run `npm run dev:frontend` (Angular dev server with
> live reload on :4200, proxying `/api`, `/content` and `/uploads` to :3004) instead of
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
| [Docs/database.md](Docs/database.md) | Schema (directory, events, raffles, board), uploads, SQLite vs MySQL, migrations |
| [Docs/email.md](Docs/email.md) | Email transports (console / SMTP / SES), verification, the testing bypass |
| [Docs/website-content.md](Docs/website-content.md) | The admin-editable website (`HTML/` sections, photos, logo, tokens) |

## License

Proprietary — © Mission Men of Anna Inc.
