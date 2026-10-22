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
-- here so any timestamps written by this script are read as UTC.
SET time_zone = '+00:00';

-- ----------------------------------------------------------------------------
-- USERS
-- ----------------------------------------------------------------------------
-- Logins exist ONLY for partner nonprofits: one account per organization
--   (organizations.user_id); first_name / last_name are the primary contact
--   person. There are no roles. Administration happens in the admin console
--   (mmoa_admin_console), whose operators are NOT users here.
-- email_verified_at: NULL until the user clicks the link in their verification
--   email. Accounts cannot log in while NULL (scripts/create-member.js and the
--   admin console can create accounts already verified).
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
    is_active         TINYINT(1) NOT NULL DEFAULT 1,
    email_verified_at TIMESTAMP NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at     TIMESTAMP NULL
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

-- ============================================================================
-- NONPROFIT DIRECTORY ("Need Help?")
-- ============================================================================
-- Logins (users) exist ONLY for other nonprofits. Each login owns exactly one
-- organizations row (created with it at signup). Only rows with
-- verification_status = 'verified' AND is_listed = 1 are ever shown publicly,
-- and then only the fields named in public_fields (name is always public; ein
-- is never public). MMoA verifies the EIN from the admin console.
-- Column notes: see setup_sqlite_db.sql (same tables, same columns).
-- (TEXT columns can't carry a DEFAULT on older MySQL, so public_fields /
-- how_to_buy are VARCHAR here; the app also fills them in when NULL.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
    org_id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id             INT NOT NULL UNIQUE,
    name                VARCHAR(200) NOT NULL,
    ein                 VARCHAR(10) NULL,
    address_line1       VARCHAR(200) NULL,
    address_line2       VARCHAR(200) NULL,
    city                VARCHAR(100) NULL,
    state               VARCHAR(40) NULL DEFAULT 'TX',
    zip                 VARCHAR(10) NULL,
    phone               VARCHAR(40) NULL,
    phone_ext           VARCHAR(10) NULL,
    public_email        VARCHAR(255) NULL,
    website_url         VARCHAR(500) NULL,
    facebook_url        VARCHAR(500) NULL,
    instagram_url       VARCHAR(500) NULL,
    other_social_url    VARCHAR(500) NULL,
    description_md      TEXT NULL,
    hours               TEXT NULL,
    what_to_bring       TEXT NULL,
    search_tags         TEXT NULL,
    public_fields       VARCHAR(1000) NULL DEFAULT '["address","phone","public_email","website_url","facebook_url","instagram_url","other_social_url","description","hours","what_to_bring","contacts","images","service_cities","categories"]',
    is_listed           TINYINT(1) NOT NULL DEFAULT 1,
    verification_status VARCHAR(16) NOT NULL DEFAULT 'unverified',
    verified_at         TIMESTAMP NULL,
    verified_by         VARCHAR(100) NULL,
    verification_note   TEXT NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NULL,
    CONSTRAINT chk_org_status CHECK (verification_status IN ('unverified','verified','rejected')),
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    INDEX idx_orgs_status (verification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_contacts (
    contact_id INT AUTO_INCREMENT PRIMARY KEY,
    org_id     INT NOT NULL,
    name       VARCHAR(200) NULL,
    role       VARCHAR(200) NULL,
    email      VARCHAR(255) NULL,
    phone      VARCHAR(40) NULL,
    phone_ext  VARCHAR(10) NULL,
    is_public  TINYINT(1) NOT NULL DEFAULT 0,
    sort       INT NOT NULL DEFAULT 0,
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE,
    INDEX idx_org_contacts_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_images (
    image_id INT AUTO_INCREMENT PRIMARY KEY,
    org_id   INT NOT NULL,
    path     VARCHAR(255) NOT NULL,
    alt      VARCHAR(300) NULL,
    sort     INT NOT NULL DEFAULT 0,
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE,
    INDEX idx_org_images_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    slug        VARCHAR(60) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    sort        INT NOT NULL DEFAULT 0,
    is_active   TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_categories (
    org_id      INT NOT NULL,
    category_id INT NOT NULL,
    PRIMARY KEY (org_id, category_id),
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories (category_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cities (
    city_id   INT AUTO_INCREMENT PRIMARY KEY,
    name      VARCHAR(100) NOT NULL UNIQUE,
    sort      INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_cities (
    org_id  INT NOT NULL,
    city_id INT NOT NULL,
    PRIMARY KEY (org_id, city_id),
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE,
    FOREIGN KEY (city_id) REFERENCES cities (city_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- EVENTS, RAFFLES, BOARD (managed in the admin console)
-- Column notes: see setup_sqlite_db.sql. starts_at carries an explicit
-- DEFAULT (see the TIMESTAMP gotcha at the top); the app always supplies it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    event_id           INT AUTO_INCREMENT PRIMARY KEY,
    slug               VARCHAR(120) NOT NULL UNIQUE,
    title              VARCHAR(200) NOT NULL,
    summary            VARCHAR(300) NULL,
    description_md     TEXT NULL,
    starts_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at            TIMESTAMP NULL,
    venue_name         VARCHAR(200) NULL,
    address            VARCHAR(300) NULL,
    city               VARCHAR(100) NULL,
    map_url            VARCHAR(1000) NULL,
    flyer_path         VARCHAR(255) NULL,
    cover_path         VARCHAR(255) NULL,
    registration_url   VARCHAR(1000) NULL,
    registration_label VARCHAR(100) NULL DEFAULT 'Register & pay',
    registration_note  VARCHAR(300) NULL,
    beneficiaries_text TEXT NULL,
    is_published       TINYINT(1) NOT NULL DEFAULT 0,
    status             VARCHAR(16) NOT NULL DEFAULT 'draft',
    preview_token      VARCHAR(64) NULL,
    preview_expires_at TIMESTAMP NULL,
    is_latest          TINYINT(1) NOT NULL DEFAULT 0,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP NULL,
    INDEX idx_events_starts (starts_at),
    INDEX idx_events_published (is_published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_beneficiaries (
    beneficiary_id INT AUTO_INCREMENT PRIMARY KEY,
    event_id       INT NOT NULL,
    org_id         INT NULL,
    name           VARCHAR(200) NULL,
    url            VARCHAR(1000) NULL,
    sort           INT NOT NULL DEFAULT 0,
    FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE SET NULL,
    INDEX idx_event_beneficiaries_event (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raffles (
    raffle_id            INT AUTO_INCREMENT PRIMARY KEY,
    slug                 VARCHAR(120) NOT NULL UNIQUE,
    title                VARCHAR(200) NOT NULL,
    prize_description_md TEXT NULL,
    flyer_path           VARCHAR(255) NULL,
    total_tickets        INT NULL,
    ticket_price_text    VARCHAR(200) NULL,
    drawing_at           TIMESTAMP NULL,
    drawing_location     VARCHAR(200) NULL,
    how_to_buy           VARCHAR(2000) NULL DEFAULT 'Tickets are sold in person only — from any MMoA member or at our booth at upcoming events. Texas law doesn''t allow raffle tickets to be sold online.',
    claim_requirements   TEXT NULL,
    claim_preset         VARCHAR(16) NULL,
    beneficiary_org_id   INT NULL,
    beneficiary_text     VARCHAR(500) NULL,
    status               VARCHAR(16) NOT NULL DEFAULT 'open',
    visibility           VARCHAR(16) NOT NULL DEFAULT 'draft',
    is_latest            TINYINT(1) NOT NULL DEFAULT 0,
    winning_ticket       VARCHAR(60) NULL,
    is_published         TINYINT(1) NOT NULL DEFAULT 0,
    preview_token        VARCHAR(64) NULL,
    preview_expires_at   TIMESTAMP NULL,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP NULL,
    CONSTRAINT chk_raffle_status CHECK (status IN ('draft','open','closed','drawn')),
    FOREIGN KEY (beneficiary_org_id) REFERENCES organizations (org_id) ON DELETE SET NULL,
    INDEX idx_raffles_status (status, is_published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raffle_beneficiaries (
    beneficiary_id INT AUTO_INCREMENT PRIMARY KEY,
    raffle_id      INT NOT NULL,
    org_id         INT NULL,
    name           VARCHAR(200) NULL,
    url            VARCHAR(1000) NULL,
    sort           INT NOT NULL DEFAULT 0,
    FOREIGN KEY (raffle_id) REFERENCES raffles (raffle_id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE SET NULL,
    INDEX idx_raffle_beneficiaries_raffle (raffle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raffle_images (
    image_id  INT AUTO_INCREMENT PRIMARY KEY,
    raffle_id INT NOT NULL,
    path      VARCHAR(255) NOT NULL,
    alt       VARCHAR(300) NULL,
    sort      INT NOT NULL DEFAULT 0,
    FOREIGN KEY (raffle_id) REFERENCES raffles (raffle_id) ON DELETE CASCADE,
    INDEX idx_raffle_images_raffle (raffle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS board_members (
    board_id         INT AUTO_INCREMENT PRIMARY KEY,
    role_title       VARCHAR(100) NOT NULL,
    role_description VARCHAR(500) NULL,
    person_name      VARCHAR(200) NULL,
    photo_path       VARCHAR(255) NULL,
    sort             INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SEEDS (guarded: re-running this file never duplicates them)
-- ============================================================================
INSERT IGNORE INTO categories (slug, name, sort) VALUES
    ('food', 'Food', 1),
    ('housing', 'Housing & shelter', 2),
    ('utilities', 'Utilities & bills', 3),
    ('clothing', 'Clothing & household items', 4),
    ('transportation', 'Transportation', 5),
    ('health', 'Health care', 6),
    ('mental-health', 'Mental health', 7),
    ('substance-use', 'Substance use', 8),
    ('financial', 'Financial help', 9),
    ('jobs', 'Jobs & job training', 10),
    ('education', 'Education & school supplies', 11),
    ('family', 'Childcare & family', 12),
    ('seniors', 'Seniors', 13),
    ('veterans', 'Veterans', 14),
    ('disabilities', 'Disability services', 15),
    ('legal', 'Legal help', 16),
    ('safety', 'Domestic violence & safety', 17),
    ('other', 'Other', 99);

INSERT IGNORE INTO cities (name, sort) VALUES
    ('Anna', 1), ('Melissa', 2), ('Van Alstyne', 3), ('Howe', 4), ('Weston', 5),
    ('Westminster', 6), ('Blue Ridge', 7), ('Princeton', 8), ('McKinney', 9), ('Sherman', 10);

INSERT INTO board_members (role_title, role_description, sort)
SELECT * FROM (
    SELECT 'Chair' AS role_title, 'Leads the organization''s meetings and sets the agenda' AS role_description, 1 AS sort
    UNION ALL SELECT 'Vice Chair', 'Supports the Chair and covers for the Chair in his absence', 2
    UNION ALL SELECT 'Secretary', 'Manages documentation, communications, and meeting records', 3
    UNION ALL SELECT 'Treasurer', 'Oversees financial matters and ensures fiscal accountability', 4
    UNION ALL SELECT 'Community Chair', 'Engages with the community to foster partnerships and support', 5
    UNION ALL SELECT 'Sergeant at Arms', 'Maintains order during meetings and ensures adherence to bylaws', 6
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM board_members);
