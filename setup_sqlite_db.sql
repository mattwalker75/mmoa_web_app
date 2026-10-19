-- ============================================================================
-- mmoa_web_app — SQLite schema
-- ============================================================================
-- The default engine (database.engine = "sqlite"), used locally AND on the
-- production EC2 instance. Production may switch to setup_mysql_db.sql.
-- Auto-created by db/database.js on first run if the file is missing.
-- Manual rebuild (WIPES the data): ./SETUP_SQLLITE_DB.sh
--   (= sqlite3 mmoa_web_app.db < setup_sqlite_db.sql on a fresh file)
--
-- Keep this file and setup_mysql_db.sql in sync — same tables, same columns.
-- The admin console (mmoa_admin_console) reads and writes this database too.
-- App code writes JS-computed UTC timestamps ('YYYY-MM-DD HH:MM:SS').
-- ============================================================================

-- ----------------------------------------------------------------------------
-- USERS
-- ----------------------------------------------------------------------------
-- Every account is a member — there are no roles. Administration happens in
--   the admin console (mmoa_admin_console), whose operators are NOT users here.
-- email_verified_at: NULL until the user clicks the link in their verification
--   email. Members cannot log in while NULL (scripts/create-member.js and the
--   admin console can create accounts already verified).
-- is_active: 0 = disabled from the admin console (login refused, sessions end).
-- login_name is case-insensitive (the NOCASE index below), like MySQL's
--   utf8mb4_unicode_ci UNIQUE.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    login_name        TEXT NOT NULL UNIQUE,
    email             TEXT NOT NULL UNIQUE,
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    phone_number      TEXT,
    password_hash     TEXT NOT NULL,
    is_active         INTEGER NOT NULL DEFAULT 1,
    email_verified_at TIMESTAMP,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at     TIMESTAMP
);
-- Login names are case-insensitive (matches MySQL's utf8mb4_unicode_ci UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_nocase ON users(login_name COLLATE NOCASE);

-- ----------------------------------------------------------------------------
-- EMAIL VERIFICATION TOKENS
-- ----------------------------------------------------------------------------
-- One row per outstanding verification link. consumed_at NULL = still valid.
-- expires_at is set from security.verificationLinkExpiresMinutes at issue time.
-- A successful verification sets consumed_at and stamps users.email_verified_at.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_expires ON email_verification_tokens(expires_at);

-- ----------------------------------------------------------------------------
-- PASSWORD RESET TOKENS
-- ----------------------------------------------------------------------------
-- One row per "forgot password" request. Single-use: a successful reset stamps
-- consumed_at, after which the link is dead even if the URL is replayed.
-- expires_at is set from config.passwordResetTokenTtlHours at issue time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);

-- ----------------------------------------------------------------------------
-- LOGIN LOCKOUTS (brute-force protection)
-- ----------------------------------------------------------------------------
-- One row per tracked axis. scope is 'ip' (scope_key = client IP) or 'account'
-- (scope_key = the lowercased login/email the visitor typed). A login is blocked
-- while EITHER matching row's locked_until_ms is in the future. fail_count is the
-- running count of consecutive failures since the last lock/success; it resets to
-- 0 when a lock is applied and the row is deleted on a successful login. Stored
-- and managed by middleware/loginLockout.js. Browse current offenders with:
--   SELECT * FROM login_lockouts WHERE locked_until_ms > <now-ms> OR fail_count > 0;
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_lockouts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scope           TEXT NOT NULL,            -- 'ip' | 'account'
    scope_key       TEXT NOT NULL,            -- IP address or lowercased identifier
    fail_count      INTEGER NOT NULL DEFAULT 0,
    locked_until_ms INTEGER,                  -- epoch ms; NULL/past = not locked
    last_failed_at  TIMESTAMP,
    updated_at      TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_login_lockouts_scope ON login_lockouts(scope, scope_key);
CREATE INDEX IF NOT EXISTS idx_login_lockouts_locked ON login_lockouts(locked_until_ms);

-- ----------------------------------------------------------------------------
-- EVENTS
-- ----------------------------------------------------------------------------
-- Community events shown on the website (GET /api/events) and on the member
-- dashboard. Managed from the admin console. Only is_published = 1 rows are
-- public. starts_at / ends_at are UTC 'YYYY-MM-DD HH:MM:SS'; ends_at NULL =
-- a single point in time. "Upcoming" = ends_at (else starts_at) not yet past.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    event_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    location     TEXT,
    starts_at    TIMESTAMP NOT NULL,
    ends_at      TIMESTAMP,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_published ON events(is_published);

-- Seed a few sample published events so the website isn't empty on a fresh
-- install. Placeholder content — edit or delete them from the admin console.
-- Guarded so re-running this file never duplicates them.
INSERT INTO events (title, description, location, starts_at, ends_at, is_published)
SELECT * FROM (
    SELECT 'Community Food Drive' AS title,
           'Help us collect and sort non-perishable food for local families in need. Drop off donations or volunteer for a shift.' AS description,
           'Anna, Texas' AS location,
           '2027-03-13 15:00:00' AS starts_at, '2027-03-13 19:00:00' AS ends_at, 1 AS is_published
    UNION ALL SELECT 'Neighborhood Yard Work Day',
           'We team up to help seniors and neighbors with yard work and small repairs. Bring gloves — we will bring the tools.',
           'Anna, Texas',
           '2027-04-17 14:00:00', '2027-04-17 18:00:00', 1
    UNION ALL SELECT 'Back-to-School Supply Giveaway',
           'Backpacks and school supplies for Anna students. Come pick up supplies, or join us to pack and hand them out.',
           'Anna, Texas',
           '2027-08-07 15:00:00', '2027-08-07 18:00:00', 1
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM events);
