# Database

## Engines

`db/database.js` is a thin dual-engine wrapper selected by `config.database.engine`:

- **SQLite** (`sqlite`, the default — locally and on the EC2 instance). The file
  `mmoa_web_app.db` (in the app directory) is auto-created from
  `setup_sqlite_db.sql` on first boot if missing. `./SETUP_SQLLITE_DB.sh` wipes
  and rebuilds it (stop the app first). SQLite has one shared connection, so
  transactions are serialized through an in-process queue.
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
therefore declare an explicit `DEFAULT`, which suppresses it.

## Shared with the admin console

The database is **shared** with `mmoa_admin_console` (Members, Locked Users,
Data Browser, Reports, Backup/Restore). Keep changes **additive** and keep both
SQL files in sync.

## Tables

- **`users`** — accounts; every account is a member (no roles).
  `login_name` and `email` unique (login name case-insensitive on both engines);
  `phone_number` optional; `is_active` (0 = disabled); `email_verified_at` (NULL
  = unverified — members can't sign in); `created_at`, `last_login_at`.
- **`email_verification_tokens`** / **`password_reset_tokens`** — single-use
  tokens (`token` unique, `expires_at`, `consumed_at`), cascade-deleted with the
  user. Consumed / long-expired rows are pruned every 15 minutes.
- **`login_lockouts`** — brute-force state per `scope` (`ip` | `account`) and
  `scope_key`: `fail_count`, `locked_until_ms` (epoch ms), `last_failed_at`.
  Resolved rows are pruned every 15 minutes.
- **`events`** — `title`, `description`, `location`, `starts_at`, `ends_at`
  (NULL = single point in time), `is_published`, `created_at`, `updated_at`.
  Only published rows are public; "upcoming" = `ends_at` (else `starts_at`) not
  yet past. Three sample 2027 events are seeded (only into an empty table).

## Migrations

`db/database.js` runs two idempotent lists on every boot, on both engines:
`COLUMN_MIGRATIONS` (`ALTER TABLE … ADD COLUMN`, "duplicate column" ignored)
and `TABLE_MIGRATIONS` (`CREATE … IF NOT EXISTS`, one DDL list per engine).
When you add a column or table: add it to **both** `setup_*.sql` files (fresh
installs) **and** to the matching list (existing installs). Note
`SETUP_MYSQL_DB.sh` grants the app user only `SELECT, INSERT, UPDATE, DELETE`,
so on MySQL apply schema changes as an admin.

SQLite **CHECK** constraints can't be `ALTER`ed; to change one, rebuild the
table (rename, recreate, `INSERT … SELECT`, drop, recreate indexes) inside a
transaction with `PRAGMA foreign_keys=OFF`.
