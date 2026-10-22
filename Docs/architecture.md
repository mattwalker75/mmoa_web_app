# Architecture

## What it is

`mmoa_web_app` is the **public-facing** half of the Mission Men of Anna site
and the **source of truth for events and raffles** (Facebook posts just link
here). Visitors see upcoming events (with flyers, maps, registration links and
Facebook-friendly Open Graph previews), current raffles (sold in person only),
the About and Partner With Us pages, an optional **Donate** button (a payment
link set in the console), and **"Need Help?"** — a search of local
nonprofits that MMoA has verified (also shown as a sliding strip on Home). Logins exist **only for other nonprofits**:
they sign up with their EIN, verify their email and maintain their directory
profile in the **portal** (choosing per field what is public). It is a port of the car-show control plane with the
car-show-only domain (deployments, AWS provisioning, payments, reviews,
subdomains) removed.

## Components

```
┌─────────────────────────────┐          ┌──────────────────────────────┐
│ Angular SPA                 │  HTTPS   │ Express server (app.js)      │
│ frontend/mmoa-web-ui/       │ ───────▶ │  /health   liveness          │
│ (home, events, raffles,     │  /api    │  /api/*    JSON API          │
│  need-help, portal, …)      │ ◀─────── │  /content/images/*, /uploads/*│
└─────────────────────────────┘          │  serves the built SPA        │
                                         │  helpers/email (console/     │──▶ SMTP / AWS SES
                                         │   SMTP/SES, outbound only)   │
                                         └───────────────┬──────────────┘
                                                         │
                                       mmoa_web_app.db (SQLite) or MySQL
                                       HTML/ (website content), uploads/, config.json,
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
  (`routes/api.js` — auth; `routes/public.js` — site, events, raffles, board,
  directory; `routes/portal.js` — the nonprofit's profile), website images at
  `/content/images`, uploaded images at `/uploads`, the SPA, and Open Graph tag
  injection for `/events/:slug` and `/raffles/:slug`.
- **Helpers** — `markdownLite.js` (safe markdown-lite → HTML; the console keeps
  a verbatim copy — keep them identical), `orgs.js` (directory visibility rules
  in one place, plus the keyword-search text), `formats.js` (EIN / state /
  phone / extension / email / link / search-keyword normalizers — the
  portal's gatekeeper; the SPA mirrors them in `core/formats.ts` to format as
  people type), `uploads.js` (image store), `sqlTime.js`.
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
| GET | `/api/site` | `{ appTitle, orgName, phone, ein, facebookUrl, donationUrl, logoUrl, sections: {hero, about, help, partner, footer} }` (tokens applied) — see [website-content.md](website-content.md). `/api/content` = legacy alias `{ sections }` |
| GET | `/api/events?when=upcoming\|past` | `{ when, events: [Event] }`. `status = 'published'` only. upcoming = `starts_at ≥ now−12h`, soonest first; past = newest first, ≤50 |
| GET | `/api/events/:slug` | `:slug` = `latest` → the event marked `is_latest` (same rules; 404 unless it's published). `{ event }` + `description_html`, `map_url`, `beneficiaries_text`, `beneficiaries: [{name, url, org_id?, profile_path?}]` (org link only while that org is verified + listed). 404 unless published — or `?preview=<token>` with the console's unexpired preview token, which returns any status plus `preview: true, status` (sent `no-store`) |
| GET | `/api/raffles?status=current\|past` | `{ status, raffles: [Raffle] }`. current = open/closed, past = drawn; published only; ≤50 |
| GET | `/api/raffles/:slug` | `{ raffle }` + `prize_html`, `images: [{url, alt}]`, `how_to_buy`, `claim_requirements: []`, `claim_preset`. `winning_ticket` only when drawn. 404 for drafts/unpublished |
| GET | `/api/board` | `{ board: [{board_id, role_title, role_description, person_name, photo_url}] }` |
| GET | `/api/directory/meta` | `{ categories: [{category_id, slug, name}], cities: [{city_id, name}] }` (active only) |
| GET | `/api/directory/search?category=<slug>[,<slug>…]&city=<name\|any>&q=<text>` | `{ categories: [{slug, name}], category (first pick, legacy), city, q, count, results: [PublicOrg] }` — verified + listed only, public fields only; several categories = an org matching ANY of them (comma-separated or repeated `category`); 400 for an unknown category/city. See [Need Help search](#need-help-search) |
| GET | `/api/directory/orgs/:id` | `{ org: PublicOrg }`, or 404 unless verified + listed |
| POST | `/api/auth/signup` | `{ org_name, ein, first_name, last_name, email, login_name, password, confirm_password }` → creates the login **and** its organization (unverified) in one transaction, emails a verification link (`devLink` too when the bypass is on). EIN: 9 digits, `12-3456789` or `123456789` |
| GET | `/api/portal/org` | Signed in + verified email. `{ org: PrivateOrg (incl. hidden fields + verification_status), preview: PublicOrg, isPublic, account, options: {categories, cities, publicFieldKeys, maxImages} }` |
| PUT | `/api/portal/org` | Any subset of the profile fields + `public_fields[]`, `is_listed`, `contacts[]` (≤10), `categories[]` (slugs), `city_ids[]`, `search_tags`; keys not sent are left alone. Fields are normalized or refused with a 400 message (`helpers/formats.js`): EIN `12-3456789`, state = a USPS code (blank → `TX`), phones `(123) 456-7890` + `phone_ext` 1–6 digits (cleared with the phone), emails, http(s) links, Facebook / Instagram profile links, ≤40 search keywords of ≤50 chars. EIN changes refused once reviewed. Returns the GET payload + `message` |
| POST | `/api/portal/org/images` | multipart, field `image` (+ optional `alt`); JPEG/PNG/WebP by magic bytes, ≤8 MB, ≤5 per org → `201 { image, images }` |
| DELETE | `/api/portal/org/images/:id` | Own photos only; deletes row + file → `{ images }` |
| PUT | `/api/portal/org/images/order` | `{ order: [image_id…], alt?: {"<id>": "text"} }` → `{ images }` |
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
parsed engine-agnostically and fails closed. New in v2: the portal looks the
org up by the session's `user_id` only (no client-supplied org ids), uploads
are magic-byte checked and size-capped, user markdown is rendered by
`markdownLite` (escape first), stored image paths must match
`<kind>/<16 hex>.<ext>`, and every outbound link field is limited to
http(s)/mailto.

## Need Help search

`GET /api/directory/search` (`routes/public.js`) filters the public orgs
(verified + listed) by:

- **Needs** — any of the picked categories (only categories the org shows
  publicly count).
- **City** — the org serves it (public `service_cities`) or is based there
  (public address).
- **Keyword** — words, not substrings: lower-cased, accents stripped, split on
  anything that isn't a letter or digit; at most 10 words, and **every** word
  must match. A query word of ≤3 characters must equal a word (so `va` doesn't
  hit "Van Alstyne"); longer ones match the start of a word (`dent` →
  "dental"). The text searched (`orgs.searchText`) is the **name**, the
  private **search keywords** (`search_tags`), the public **services**, and the
  public **address, hours and cities served** — not the description or "What
  to bring" (too many incidental words).

Results sort by how many of the picked needs they cover, then keyword score
(per word: name 3, service or search keyword 2, anything else 1), then name.
The search keywords are never sent to the browser — only the org's own portal
and the admin console show them.

Open Graph: `GET /events/<slug>` and `/raffles/<slug>` (page loads, not
`/api`) return `index.html` with `<title>`, `og:title/description/url/image`
and `twitter:card` injected (absolute URLs from `publicBaseUrl`; flyer → cover
→ first photo → `carshow.jpg`), so Facebook previews show the event. Unknown
or unpublished slugs get the plain index with status 404. With a valid
`?preview=<token>`, `/events/<slug>` instead returns the plain index with
`frame-ancestors *`, no `X-Frame-Options`, `no-store` and `X-Robots-Tag:
noindex` — the console shows that page in a framed pop-up on its own origin.
Only that response is frameable; it's read-only and needs a fresh token
(30 min, newest only) that only console admins get. The SPA shows a
"Preview" banner on it.

## The no-admin-surface principle

**This app exposes no administrative capability.** There are no admin pages,
no admin API, and no user-management endpoints, and no roles — every login
belongs to one partner nonprofit. Verification of nonprofits, events, raffles,
the board, categories and cities are all managed in
**mmoa_admin_console**, which reaches this app's directory (locally, over SSH,
or through AWS SSM) and:

- edits `config.json`, `HTML/<section>.html` (hero, about, help, partner,
  footer) and `HTML/images/`;
- writes/deletes uploaded images in `uploads/{events,raffles,orgs,board}/`;
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
