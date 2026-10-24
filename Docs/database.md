# Database

## Engines

`db/database.js` is a thin dual-engine wrapper selected by `config.database.engine`:

- **SQLite** (`sqlite`, the default — locally and on the EC2 instance). The file
  `mmoa_web_app.db` (in the app directory) is auto-created from
  `setup_sqlite_db.sql` on first boot if missing. `./SETUP_SQLLITE_DB.sh` wipes
  and rebuilds it (it refuses while the app is running — `./STOP_APP.sh` first).
  SQLite has one shared connection, so transactions are serialized through an
  in-process queue, and while one is open every other `db.*` statement waits
  for it (inside `transaction(fn)` use `tx.*`, which never waits). The
  connection runs in **WAL** journal mode with a 5 s busy timeout, so the
  admin console's writes to the same file don't surface as `SQLITE_BUSY`
  errors; WAL keeps two sidecar files next to the database,
  `mmoa_web_app.db-wal` and `mmoa_web_app.db-shm` (git-ignored, removed by
  `SETUP_SQLLITE_DB.sh`) — back up all three together, or use
  `sqlite3 mmoa_web_app.db ".backup out.db"`.
- **MySQL / MariaDB** (`mysql`). Run `./SETUP_MYSQL_DB.sh` (drops + recreates the
  database and the `mmoa_app` user from `config.json`, then loads
  `setup_mysql_db.sql`) or load `setup_mysql_db.sql` yourself, then set the
  `database.mysql.*` credentials. Every pooled connection is pinned to UTC
  (driver `timezone: 'Z'` and session `time_zone = '+00:00'`).

Both expose the same async API: `getAsync(sql, params)`, `allAsync(sql, params)`,
`runAsync(sql, params)` → `{ lastID, changes }`, and `transaction(fn)`.

### Portability rules
The same SQL runs on both engines, so **app code never uses SQLite-only
`datetime(...)` or `CURRENT_TIMESTAMP`** — it computes UTC timestamps in JS and
binds them (`sqlTime()` → `'YYYY-MM-DD HH:MM:SS'`), and reads them back with
`parseSqlTimeMs()` (SQLite returns strings, mysql2 returns `Date`s). Token
expiry fails closed if a value can't be parsed. `COALESCE`, `LOWER` and plain
comparisons are fine on both.

MySQL note: on servers with `explicit_defaults_for_timestamp = OFF` (MySQL 5.7,
MariaDB < 10.10) the first `TIMESTAMP NOT NULL` column of a table silently gets
`ON UPDATE CURRENT_TIMESTAMP`. `events.starts_at` and the tokens' `expires_at`
therefore declare an explicit `DEFAULT`, which suppresses it. MySQL `TEXT`
columns can't carry a `DEFAULT` on older servers, so `organizations.public_fields`
and `raffles.how_to_buy` are `VARCHAR` there (same content).

## Shared with the admin console

The database is **shared** with `mmoa_admin_console` (Nonprofits, Events,
Raffles, Categories & Cities, Board, Locked Users, Data Browser, Reports,
Backup/Restore). Keep changes **additive** and keep both SQL files in sync.

## Tables

All timestamps are JS-computed UTC `'YYYY-MM-DD HH:MM:SS'` (`sqlTime`).
"Paths" are relative to `uploads/` (see below).

**Accounts & security**
- **`users`** — logins. They exist **only for partner nonprofits** (one login
  per organization); `first_name` / `last_name` are the primary contact person.
  `login_name` and `email` unique (login name case-insensitive on both
  engines); `phone_number` optional; `is_active` (0 = disabled);
  `email_verified_at` (NULL = can't sign in); `created_at`, `last_login_at`.
- **`email_verification_tokens`** / **`password_reset_tokens`** — single-use
  tokens (`token` unique, `expires_at`, `consumed_at`), cascade-deleted with the
  user. Consumed / long-expired rows are pruned every 15 minutes.
- **`login_lockouts`** — brute-force state per `scope` (`ip` | `account`) and
  `scope_key`: `fail_count`, `locked_until_ms` (epoch ms), `last_failed_at`.
  An `account` row whose `locked_until_ms` is `253402300799000` (year 9999)
  is a lock applied by an admin from the console ("Lock login"); it never
  lapses and the login API answers 403 `account_locked` until the row is
  deleted (console "Unlock login" / Locked Users → Unlock).

**"Need Help?" directory**
- **`organizations`** — 1:1 with `users` (`user_id` UNIQUE, CASCADE). `name`,
  `ein` (`'XX-XXXXXXX'`, never public, editable by the org only while
  unverified), `address_line1/2`, `city`, `state` (default `TX`), `zip`,
  `phone` (`(123) 456-7890`), `phone_ext` (1–6 digits, optional),
  `public_email`, `website_url`, `facebook_url`, `instagram_url`,
  `other_social_url`, `description_md` (markdown-lite), `hours`,
  `what_to_bring` (newline list), `search_tags` (comma-separated private
  search keywords — **never public**, only matched by the keyword search),
  `public_fields` (JSON array of the keys shown
  publicly — `address, phone, public_email, website_url, facebook_url,
  instagram_url, other_social_url, description, hours, what_to_bring, contacts,
  images, service_cities, categories`; default all), `is_listed` (0 = org hid
  its profile), `verification_status` (`unverified` | `verified` | `rejected`,
  CHECK), `verified_at`, `verified_by` (console admin), `verification_note`
  (console-only; not shown to the org), `created_at`, `updated_at`.
  `admin_hidden` (1 = hidden by MMoA from the console — an override the org
  can't undo), `preview_token` + `preview_expires_at` (the console's Preview
  link). **Public = `verified` AND `is_listed = 1` AND `admin_hidden = 0`, and
  then only `public_fields`.**
  Hidden categories / cities / text are also not used to match searches
  (`search_tags` is the one private field searches use — that's its purpose).
- **`org_contacts`** — `contact_id`, `org_id` (CASCADE), `name`, `role`,
  `email`, `phone`, `phone_ext`, `is_public` (0/1), `sort`.
- **`org_images`** — `image_id`, `org_id` (CASCADE), `path` (`orgs/…`), `alt`
  (also shown as the photo's caption on the public profile), `sort`. Max 5
  per org (enforced by the API).
- **`categories`** — `category_id`, `slug` (UNIQUE), `name`, `sort`,
  `is_active`. 18 seeded (food … safety, then **Other**, sort 99). `other` is
  *built in*: the app re-adds it on every boot and reads its slug ("other
  needs" in the search summary), so the console locks its slug and won't
  delete it.
- **`org_categories`** — (`org_id`, `category_id`) PK, both CASCADE.
- **`cities`** — `city_id`, `name` (UNIQUE), `sort`, `is_active`. 10 seeded
  (Anna, Melissa, Van Alstyne, Howe, Weston, Westminster, Blue Ridge,
  Princeton, McKinney, Sherman).
- **`org_cities`** — (`org_id`, `city_id`) PK, both CASCADE.

**Events, raffles, board** (managed in the console)
- **`events`** — `event_id`, `slug` (UNIQUE; the public URL `/events/<slug>`),
  `title`, `summary` (≤200), `description_md`, `starts_at`, `ends_at` (NULL
  ok), `venue_name`, `address`, `city`, `map_url` (blank → Google Maps search
  built from venue/address/city), `flyer_path`, `cover_path` (`events/…`),
  `registration_url` (any https URL, e.g. a Stripe Payment Link),
  `registration_label` (default `Register & pay`), `registration_note` (e.g.
  `$25 entry`), `beneficiaries_text`, `status` (`draft` | `published` |
  `archived`, default `draft`), `is_published` (legacy mirror — 1 only while
  published; the console keeps it in step, and a boot row migration turns
  any `is_published = 1` draft into `published`), `preview_token` +
  `preview_expires_at` (the console's 30-minute Preview link), `is_latest`
  (1 on at most one event — the console clears the others when it sets one;
  that event is also served at `/events/latest`, so `latest` is a reserved
  slug),
  `created_at`, `updated_at`. Public = `status = 'published'`; "upcoming" = `starts_at` no
  more than 12 h ago (sorted soonest first); "past" = the rest, newest first,
  50 max.
- **`event_beneficiaries`** — `beneficiary_id` (PK), `event_id` (CASCADE),
  `org_id` (NULL, `ON DELETE SET NULL`), `name`, `url`, `sort`. A row with
  `org_id` links to that org's directory profile only while the org is public;
  the org's name is used as a fallback only then too.
- **`raffles`** — `raffle_id`, `slug` (UNIQUE; `/raffles/<slug>`), `title`,
  `prize_description_md`, `flyer_path` (`raffles/…`), `total_tickets`,
  `ticket_price_text`, `drawing_at`, `drawing_location`, `how_to_buy` (default:
  in-person-only / Texas-law text), `claim_requirements` (newline list),
  `claim_preset` (`firearm` | `standard` | `custom`), `beneficiary_org_id`
  (NULL, SET NULL), `beneficiary_text`, `visibility` (`draft` | `published` |
  `archived`, like events), `status` = the **stage** (`open` | `closed` |
  `drawn`; `draft` is a legacy value — on boot it becomes visibility draft +
  stage open), `winning_ticket`, `is_published` (legacy mirror, 1 only while
  published), `is_latest` (1 on at most one raffle — the console clears the
  others — also served at `/raffles/latest`; `latest` is a reserved slug), `preview_token` + `preview_expires_at` (console Preview),
  `created_at`, `updated_at`. Public = `visibility = 'published'` (any stage);
  "current" = open/closed, "past" = drawn; `winning_ticket` is only sent once
  drawn. The stage can be stepped in any visibility, so a draft can be
  previewed in each stage.
- **`raffle_beneficiaries`** — like `event_beneficiaries`: `beneficiary_id`,
  `raffle_id` (CASCADE), `org_id` (NULL, SET NULL), `name`, `url`, `sort`. An
  org row links to its profile only while the org is public. The raffle's
  `beneficiary_text` is the note shown with the list. (The old single
  `raffles.beneficiary_org_id` is copied into a row on boot, then cleared.)
- **`raffle_images`** — `image_id`, `raffle_id` (CASCADE), `path`
  (`raffles/…`), `alt`, `sort` (prize photos, up to 8 — console-enforced).
- **`board_members`** — `board_id`, `role_title`, `role_description`,
  `person_name` (NULL until filled), `photo_path` (`board/…`), `sort`. The six
  roles (Chair … Sergeant at Arms) are seeded.

Seeds (categories, cities, board roles) are guarded — re-running a setup file
never duplicates them. No sample events/raffles/orgs are seeded; for a demo
run `node scripts/seed-sample-data.js` (and `--remove` to undo).

**Admin console**
- **`org_metrics`** — anonymous usage counts per nonprofit
  (`helpers/orgMetrics.js`): `kind` (`search` = appeared in Need Help results,
  `view` = profile opened, `call` / `directions` / `website` / `email` /
  `facebook` / `instagram` / `other_link` = that link used), `bucket`
  (`hour` | `day` | `week`), `bucket_start` (UTC), `n`. Counted in memory,
  written hourly; a daily rollup turns hours older than 7 days into days,
  days older than 28 days into weeks (Monday UTC), and deletes rows older
  than 5 years. No visitor data of any kind. Read by `GET /api/portal/metrics`
  (own org) and the console's "Nonprofit activity" report.
- **`admin_audit`** — written only by the admin console (this app just
  creates the table): `audit_id`, `at` (UTC), `admin` (console login),
  `action` (dotted, e.g. `event.publish`), `target_kind` / `target_id` /
  `target_label`, `summary`, `ip`. Shows in the console's Audit log and the
  Data Browser, and is included in backups.

## Uploaded images

Files live in `<appDir>/uploads/{events,raffles,orgs,board}/<16 random hex>.<jpg|png|webp>`
(gitignored; `uploads/.gitkeep` keeps the folder) and are served read-only at
`/uploads/…` (no index, no dotfiles, 1 h cache; misses are plain 404s). The DB
stores the relative path (`orgs/3f9c0a1b2c3d4e5f.jpg`); the API refuses any
stored path not matching that pattern. Only JPEG/PNG/WebP are accepted,
checked by magic bytes, max `uploads.maxMb` (8 MB). Browsers resize before
upload (≤1600 px long edge, JPEG q≈0.82). Deleting a row/image deletes its file
(best effort) — the portal does this for org photos; the console for the rest
(and for every image of an org/account it deletes, since the DB cascade can't
remove files).

## Migrations

`db/database.js` runs, on every boot and on both engines:

1. **Schema v2 tables** (`SCHEMA_V2_TABLES`): each table that is *missing* is
   created — DDL + indexes + its seed rows read straight out of
   `setup_sqlite_db.sql` / `setup_mysql_db.sql`, so there's no second copy to
   keep in sync. Existing tables are never touched (a category the console
   deleted isn't resurrected). Before that, a v1 `events` table (old column set
   `title/description/location`, no `slug`) is **dropped** and recreated —
   it only ever held the placeholder seed events.
2. `TABLE_MIGRATIONS` (indexes, `CREATE … IF NOT EXISTS`, one list per engine).
3. `COLUMN_MIGRATIONS` (`ALTER TABLE … ADD COLUMN`, "duplicate column" ignored)
   — so far `organizations.phone_ext`, `org_contacts.phone_ext`,
   `organizations.search_tags`, `events.status`, `events.preview_token`,
   `events.preview_expires_at`, `events.is_latest`, `raffles.preview_token`,
   `raffles.preview_expires_at`, `raffles.visibility`, `raffles.is_latest`.
4. `ROW_MIGRATIONS` — reference rows the app depends on, inserted only if
   missing (`INSERT OR IGNORE` / `INSERT IGNORE`): today the `other` category;
   plus the `events.status` backfill and the raffle visibility / stage
   conversion described above (idempotent `UPDATE`s).

When you add a column: add it to **both** `setup_*.sql` files **and**
`COLUMN_MIGRATIONS`. A new table: add it to both files and append its name to
`SCHEMA_V2_TABLES`. Note `SETUP_MYSQL_DB.sh` grants the app user only
`SELECT, INSERT, UPDATE, DELETE`, so on MySQL the boot migration can't create
tables (it logs a warning) — apply schema changes as an admin (or re-run
`setup_mysql_db.sql`, which is idempotent).

SQLite **CHECK** constraints can't be `ALTER`ed; to change one, rebuild the
table (rename, recreate, `INSERT … SELECT`, drop, recreate indexes) inside a
transaction with `PRAGMA foreign_keys=OFF`.
