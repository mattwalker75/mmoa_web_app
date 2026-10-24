# Website content (admin-editable)

Most of the site is data-driven (events, raffles, board, the "Need Help?"
directory — all in the database, managed in the admin console). The remaining
**copy** lives in editable HTML fragment files in **`HTML/`**, one per
section, plus site photos in **`HTML/images/`**. The admin console (Web App
Website) edits these; **no rebuild or restart is needed** (changes show on the
next page load).

## Sections (the 5 keys)

| Key / file | Where it appears | Contents |
|---|---|---|
| `hero` → `HTML/hero.html` | Home, top banner | Background photo (`<img class="hero-bg">`) + `.hero-inner` with kicker, `<h1>`, lede and the two CTA buttons |
| `about` → `HTML/about.html` | Home "story" block **and** top of `/about` | Story intro: the `.marker` accent line + paragraphs. No heading (the page provides it). |
| `help` → `HTML/help.html` | `/about` → "How you can help" | `<ul class="help-list">` items (`<strong>` title + text) and `<p class="tagline">`. No heading. |
| `partner` → `HTML/partner.html` | `/partner` (Partner With Us) body | Lede, `<h2>` sub-sections, `.help-list`, `<ol class="steps">`. The page adds its own H1 and the sign-up call-to-action card. |
| `footer` → `HTML/footer.html` | Every page | `.foot-org` (name, EIN, phone, ©) + `<nav class="foot-links">`. The **"Need help now? 911 · 988 · 211" box is built into the SPA**, not this file, so it can't be edited away. |

The v1 sections (`mission`, `events`, `involved`) and `HTML/windows.json`
(per-section window chrome) are **gone** in v2 — the dark design has fixed
section styling. The admin console's windows editor was removed with it.

Each file holds **inner HTML**. Use the site's global CSS classes so it matches
the design: `kicker`, `lede`, `marker`, `prose`, `btn btn-primary` /
`btn-outline` / `btn-dark` / `btn-lg`, `cta-row`, `help-list`, `tagline`,
`steps`, `muted`, `soft`; in the hero `hero-bg` / `hero-inner`; in the footer
`foot-org`, `foot-brand`, `foot-copy`, `foot-links`.

Links to site pages (`href="/events"`) navigate inside the app without a
reload. The content is injected as **trusted** HTML (first-party, admin-only) —
never put untrusted input in these files. Scripts won't run anyway (the CSP
allows only the app's own script files).

## Tokens

These `{{tokens}}` are filled by the server (HTML-escaped):

| Token | Value |
|---|---|
| `{{appTitle}}` | `config.appTitle` (Mission Men of Anna) |
| `{{orgName}}` | `config.orgName` (Mission Men of Anna Inc) |
| `{{phone}}` | `config.site.phone` — `(214) 763-5546` |
| `{{phoneTel}}` | the same phone as digits for `tel:` links — `+12147635546` |
| `{{ein}}` | `config.site.ein` — `33-4035685` |
| `{{facebookUrl}}` | `config.site.facebookUrl` |
| `{{donationUrl}}` | `config.site.donationUrl` (blank when not set — only use it in a fragment if a link is configured) |
| `{{appSubtitle}}`, `{{tagline}}`, `{{foundedYear}}`, `{{meetingInfo}}` | `config.appSubtitle`, `config.site.tagline` / `foundedYear` / `meetingInfo` — optional text facts |
| `{{email}}` | `config.site.email` — public contact address (use as `mailto:{{email}}`) |
| `{{addressLine1}}`, `{{addressLine2}}`, `{{city}}`, `{{state}}`, `{{zip}}`, `{{address}}` | `config.site.*` mailing address parts; `{{address}}` is all of them on one line ("PO Box 123, Anna, TX 75409") |
| `{{instagramUrl}}`, `{{youtubeUrl}}`, `{{xUrl}}`, `{{nextdoorUrl}}` | `config.site.*` social links (http(s) only, else blank) |
| `{{year}}`, `{{eventCount}}` | the current year; the number of upcoming published events |

Every value is set in the admin console under Web App Settings → General,
which shows the token next to each field. An unset value renders as nothing,
so a fragment can mention a token that is not filled in yet.
| `{{year}}` | current year |
| `{{eventCount}}` | number of upcoming published events |

Unknown tokens are left as-is.

## Images

- **Site photos** live in `HTML/images/` (committed) and are served at
  `/content/images/<file>`: `carshow.jpg` (hero), `booth.jpg`,
  `volunteers.jpg`, `fundraiser.jpg`, `legion.jpg` (home photo grid),
  `group.jpg`, `angeltree.jpg` (About). The SPA refers to these names, so
  replace a photo by overwriting the file with the same name.
- **Logo:** the header shows a built-in stand-in eagle-with-M-shield SVG. Drop
  `HTML/images/logo.png` (or `logo.svg`) and the header uses that file instead
  (`GET /api/site` → `logoUrl`); `logo.png` is also shown on the maintenance
  screen.
- **Uploaded images** (event flyers/covers, raffle photos, nonprofit photos,
  board photos) are NOT here — they live in `uploads/` (gitignored), see
  [database.md](database.md#uploaded-images).

## Not in a section file

The core values (with descriptions), the "What we've done" impact list and the
photo captions are fixed copy in `frontend/mmoa-web-ui/src/app/core/site-content.ts`
(edit + rebuild). The "Need Help?" / directory UI strings are in
`core/strings.ts` (kept together so a Spanish translation can be added later).

## How it works

`GET /api/site` reads the section files (mtime-cached → live but cheap),
substitutes tokens, and returns
`{ appTitle, orgName, phone, ein, facebookUrl, donationUrl, logoUrl, sections: { hero, about, help, partner, footer } }`.
(`GET /api/content` is kept as a legacy alias returning `{ sections }`.)
