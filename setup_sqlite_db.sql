-- ============================================================================
-- mmoa_web_app — SQLite schema
-- ============================================================================
-- The default engine (database.engine = "sqlite"), used locally AND on the
-- production EC2 instance. Production may switch to setup_mysql_db.sql.
-- Auto-created by db/database.js on first run if the file is missing.
-- Manual rebuild (WIPES the data): ./SETUP_SQLLITE_DB.sh
--   (= sqlite3 mmoa_web_app.db < setup_sqlite_db.sql on a fresh file)
-- Seeds only reference data (categories, cities, board roles) — no sample
-- events/raffles/orgs (scripts/seed-sample-data.js adds those on demand).
--
-- Keep this file and setup_mysql_db.sql in sync — same tables, same columns.
-- The admin console (mmoa_admin_console) reads and writes this database too.
-- App code writes JS-computed UTC timestamps ('YYYY-MM-DD HH:MM:SS').
-- ============================================================================

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


-- ============================================================================
-- NONPROFIT DIRECTORY ("Need Help?")
-- ============================================================================
-- Logins (users) exist ONLY for other nonprofits. Each login owns exactly one
-- organizations row (created with it at signup). Only rows with
-- verification_status = 'verified' AND is_listed = 1 are ever shown publicly,
-- and then only the fields named in public_fields (name is always public; ein
-- is never public). MMoA verifies the EIN from the admin console.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ORGANIZATIONS (1:1 with users)
-- ----------------------------------------------------------------------------
-- ein: 9 digits stored as 'XX-XXXXXXX'; editable by the org only while
--   verification_status = 'unverified'.
-- what_to_bring: newline-separated list.
-- search_tags: private comma-separated search keywords (never shown publicly;
--   only used to match the "Need Help?" keyword search).
-- public_fields: JSON array of field keys shown publicly — any of
--   address, phone, public_email, website_url, facebook_url, instagram_url,
--   other_social_url, description, hours, what_to_bring, contacts, images,
--   service_cities, categories. Hidden categories / cities are also not used
--   to match searches.
-- is_listed: 0 = the org has hidden its whole profile.
-- verified_by: console admin login that verified / rejected it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    org_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    ein                 TEXT,
    address_line1       TEXT,
    address_line2       TEXT,
    city                TEXT,
    state               TEXT DEFAULT 'TX',
    zip                 TEXT,
    phone               TEXT,
    phone_ext           TEXT,             -- optional extension, digits only
    public_email        TEXT,
    website_url         TEXT,
    facebook_url        TEXT,
    instagram_url       TEXT,
    other_social_url    TEXT,
    description_md      TEXT,
    hours               TEXT,
    what_to_bring       TEXT,
    search_tags         TEXT,             -- private search keywords, comma-separated
    public_fields       TEXT DEFAULT '["address","phone","public_email","website_url","facebook_url","instagram_url","other_social_url","description","hours","what_to_bring","contacts","images","service_cities","categories"]',
    is_listed           INTEGER NOT NULL DEFAULT 1,
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','rejected')),
    verified_at         TIMESTAMP,
    verified_by         TEXT,
    verification_note   TEXT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_orgs_status ON organizations(verification_status);

-- People to contact at the org. is_public = 1 → shown on the public profile
-- (when the org also has "contacts" in public_fields).
CREATE TABLE IF NOT EXISTS org_contacts (
    contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL,
    name       TEXT,
    role       TEXT,
    email      TEXT,
    phone      TEXT,
    phone_ext  TEXT,
    is_public  INTEGER NOT NULL DEFAULT 0,
    sort       INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_org_contacts_org ON org_contacts(org_id);

-- Org photos (max 5 per org, enforced in the API). path is relative to the
-- app's uploads/ directory, e.g. 'orgs/3f9c0a1b2c3d4e5f.jpg'.
CREATE TABLE IF NOT EXISTS org_images (
    image_id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id   INTEGER NOT NULL,
    path     TEXT NOT NULL,
    alt      TEXT,
    sort     INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_org_images_org ON org_images(org_id);

-- Service categories people search by (managed in the console).
CREATE TABLE IF NOT EXISTS categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS org_categories (
    org_id      INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    PRIMARY KEY (org_id, category_id),
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories (category_id) ON DELETE CASCADE
);

-- Cities an org can say it serves (managed in the console).
CREATE TABLE IF NOT EXISTS cities (
    city_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE,
    sort      INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS org_cities (
    org_id  INTEGER NOT NULL,
    city_id INTEGER NOT NULL,
    PRIMARY KEY (org_id, city_id),
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE CASCADE,
    FOREIGN KEY (city_id) REFERENCES cities (city_id) ON DELETE CASCADE
);

-- ============================================================================
-- EVENTS, RAFFLES, BOARD (managed in the admin console)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EVENTS
-- ----------------------------------------------------------------------------
-- Only is_published = 1 rows are public (GET /api/events, /events/<slug>).
-- starts_at / ends_at are UTC 'YYYY-MM-DD HH:MM:SS'. "Upcoming" = starts_at
-- no more than 12 hours ago. description_md uses the markdown-lite rules
-- (helpers/markdownLite.js). map_url blank → the site builds a Google Maps
-- search link from venue_name / address / city. flyer_path / cover_path are
-- relative to uploads/ ('events/<16 hex>.jpg'). registration_url is any https
-- URL (e.g. a Stripe Payment Link).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    event_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug               TEXT NOT NULL UNIQUE,
    title              TEXT NOT NULL,
    summary            TEXT,
    description_md     TEXT,
    starts_at          TIMESTAMP NOT NULL,
    ends_at            TIMESTAMP,
    venue_name         TEXT,
    address            TEXT,
    city               TEXT,
    map_url            TEXT,
    flyer_path         TEXT,
    cover_path         TEXT,
    registration_url   TEXT,
    registration_label TEXT DEFAULT 'Register & pay',
    registration_note  TEXT,
    beneficiaries_text TEXT,
    is_published       INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_published ON events(is_published);

-- Who an event benefits. org_id set → links to that org's directory profile
-- (only while the org is verified + listed); otherwise name (+ optional url).
CREATE TABLE IF NOT EXISTS event_beneficiaries (
    beneficiary_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id       INTEGER NOT NULL,
    org_id         INTEGER,
    name           TEXT,
    url            TEXT,
    sort           INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations (org_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_event_beneficiaries_event ON event_beneficiaries(event_id);

-- ----------------------------------------------------------------------------
-- RAFFLES
-- ----------------------------------------------------------------------------
-- Public only when is_published = 1 AND status <> 'draft'. "Current" =
-- open | closed, "past" = drawn. winning_ticket is shown only once drawn.
-- claim_requirements: newline-separated list (the console's Firearm /
-- Standard presets fill it; claim_preset records which one was used).
-- Tickets are never sold online (Texas law) — how_to_buy says so.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raffles (
    raffle_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug                 TEXT NOT NULL UNIQUE,
    title                TEXT NOT NULL,
    prize_description_md TEXT,
    flyer_path           TEXT,
    total_tickets        INTEGER,
    ticket_price_text    TEXT,
    drawing_at           TIMESTAMP,
    drawing_location     TEXT,
    how_to_buy           TEXT DEFAULT 'Tickets are sold in person only — from any MMoA member or at our booth at upcoming events. Texas law doesn''t allow raffle tickets to be sold online.',
    claim_requirements   TEXT,
    claim_preset         TEXT,
    beneficiary_org_id   INTEGER,
    beneficiary_text     TEXT,
    status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','drawn')),
    winning_ticket       TEXT,
    is_published         INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP,
    FOREIGN KEY (beneficiary_org_id) REFERENCES organizations (org_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status, is_published);

-- Prize photos (up to 8 per raffle, enforced in the console).
CREATE TABLE IF NOT EXISTS raffle_images (
    image_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    raffle_id INTEGER NOT NULL,
    path      TEXT NOT NULL,
    alt       TEXT,
    sort      INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (raffle_id) REFERENCES raffles (raffle_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raffle_images_raffle ON raffle_images(raffle_id);

-- ----------------------------------------------------------------------------
-- BOARD MEMBERS (About page)
-- ----------------------------------------------------------------------------
-- One row per board role; person_name / photo_path NULL until the console
-- fills them in. photo_path is relative to uploads/ ('board/<16 hex>.jpg').
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_members (
    board_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role_title       TEXT NOT NULL,
    role_description TEXT,
    person_name      TEXT,
    photo_path       TEXT,
    sort             INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- SEEDS (guarded: re-running this file never duplicates them)
-- ============================================================================
INSERT OR IGNORE INTO categories (slug, name, sort) VALUES
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

INSERT OR IGNORE INTO cities (name, sort) VALUES
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
