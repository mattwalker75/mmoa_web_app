-- ============================================================================
-- mmoa_web_app — MySQL schema
-- ============================================================================
-- Run on a fresh MySQL / MariaDB instance:
--   mysql -u root -p < setup_mysql_db.sql
-- or ./SETUP_MYSQL_DB.sh (drops + recreates the database and app user from
-- config.json first). Then set database.engine = "mysql" in config.json.
--
-- Keep this file and setup_sqlite_db.sql in sync — same tables, same columns.
-- The admin console (mmoa_admin_console) reads and writes this database too.
--
-- TIMESTAMP gotcha: on servers with explicit_defaults_for_timestamp = OFF
-- (MySQL 5.7, MariaDB < 10.10), the FIRST TIMESTAMP NOT NULL column of a table
-- silently gets DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP — so
-- every UPDATE of the row would overwrite it (an event's start time, a token's
-- expiry). Those columns below therefore carry an explicit DEFAULT, which
-- suppresses the auto-update. The app always supplies their values.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS mmoa_web_app
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

USE mmoa_web_app;

-- The app stores UTC (db/database.js pins its sessions to +00:00); do the same
-- here so the seed timestamps below are read as UTC, not the server's zone.
SET time_zone = '+00:00';

-- ----------------------------------------------------------------------------
-- USERS
-- ----------------------------------------------------------------------------
-- role:
--   'member' — everyone who signs up on the website
--   'admin'  — an organizer account (created by scripts/create-admin.js or the
--              admin console). The web app has no admin pages; the role is
--              informational for the console and exempt from the email gate.
-- email_verified_at: NULL until the user clicks the link in their verification
--   email. Members cannot log in while NULL; admins are created already-verified.
-- is_active: 0 = disabled from the admin console (login refused, sessions end).
-- login_name is case-insensitive through the utf8mb4_unicode_ci collation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id           INT AUTO_INCREMENT PRIMARY KEY,
    login_name        VARCHAR(100) NOT NULL UNIQUE,
    email             VARCHAR(255) NOT NULL UNIQUE,
    first_name        VARCHAR(100) NOT NULL,
    last_name         VARCHAR(100) NOT NULL,
    phone_number      VARCHAR(40) NULL,
    password_hash     VARCHAR(255) NOT NULL,
    role              ENUM('member', 'admin') NOT NULL DEFAULT 'member',
    is_active         TINYINT(1) NOT NULL DEFAULT 1,
    email_verified_at TIMESTAMP NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at     TIMESTAMP NULL,
    INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- EMAIL VERIFICATION TOKENS
-- ----------------------------------------------------------------------------
-- One row per outstanding verification link. consumed_at NULL = still valid.
-- expires_at is set from security.verificationLinkExpiresMinutes at issue time.
-- A successful verification sets consumed_at and stamps users.email_verified_at.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    token       VARCHAR(128) NOT NULL UNIQUE,
    expires_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at TIMESTAMP NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    INDEX idx_evt_user (user_id),
    INDEX idx_evt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- PASSWORD RESET TOKENS
-- ----------------------------------------------------------------------------
-- One row per "forgot password" request. Single-use: a successful reset stamps
-- consumed_at, after which the link is dead even if the URL is replayed.
-- expires_at is set from config.passwordResetTokenTtlHours at issue time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    token       VARCHAR(128) NOT NULL UNIQUE,
    expires_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at TIMESTAMP NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    INDEX idx_prt_user (user_id),
    INDEX idx_prt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- LOGIN LOCKOUTS (brute-force protection)
-- ----------------------------------------------------------------------------
-- One row per tracked axis. scope is 'ip' (scope_key = client IP) or 'account'
-- (scope_key = the lowercased login/email typed). A login is blocked while EITHER
-- matching row's locked_until_ms is in the future. fail_count is the running count
-- of consecutive failures since the last lock/success; it resets to 0 when a lock
-- is applied and the row is deleted on a successful login. Managed by
-- middleware/loginLockout.js. Browse current offenders with:
--   SELECT * FROM login_lockouts WHERE locked_until_ms > <now-ms> OR fail_count > 0;
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_lockouts (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    scope           VARCHAR(16) NOT NULL,
    scope_key       VARCHAR(255) NOT NULL,
    fail_count      INT NOT NULL DEFAULT 0,
    locked_until_ms BIGINT NULL,
    last_failed_at  TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY idx_login_lockouts_scope (scope, scope_key),
    INDEX idx_login_lockouts_locked (locked_until_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- EVENTS
-- ----------------------------------------------------------------------------
-- Community events shown on the website (GET /api/events) and on the member
-- dashboard. Managed from the admin console. Only is_published = 1 rows are
-- public. starts_at / ends_at are UTC; ends_at NULL = a single point in time.
-- "Upcoming" = ends_at (else starts_at) not yet past.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    event_id     INT AUTO_INCREMENT PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    description  TEXT NULL,
    location     VARCHAR(255) NULL,
    starts_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at      TIMESTAMP NULL,
    is_published TINYINT(1) NOT NULL DEFAULT 1,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NULL,
    INDEX idx_events_starts (starts_at),
    INDEX idx_events_published (is_published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed a few sample published events so the website isn't empty on a fresh
-- install. Placeholder content — edit or delete them from the admin console.
-- Guarded so re-running this file never duplicates them. (Times are UTC.)
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
