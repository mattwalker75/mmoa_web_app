# Website content (admin-editable)

The home page is assembled from **editable HTML fragment files** in the repo's
**`HTML/`** directory — one per section — plus images in **`HTML/images/`** and
window styling in **`HTML/windows.json`**. The admin console (Web App Website)
edits these; **no rebuild or restart is needed** (changes show on the next page
load).

## Files (the 5 sections)

| File | Section | Anchor |
|---|---|---|
| `HTML/hero.html` | Top banner | `#hero` |
| `HTML/mission.html` | Mission statement | `#mission` |
| `HTML/events.html` | Events **heading only** — the event cards below it come from the database (`events` table, managed in the console) | `#events` |
| `HTML/involved.html` | Get involved / join | `#involved` |
| `HTML/footer.html` | Site-wide footer (every page) | — |

Each file holds the **inner HTML** of that section. Use the site's CSS classes so
it matches the design: `hero`, `hero-cta`, `eyebrow`, `lede`, `muted`, `center`,
`narrow`, `center-block`, `tile-grid` + `card tile`, `btn btn-primary` /
`btn-ghost` / `btn-dark` / `btn-light`, `small-print`, and in the footer
`foot-grid`, `foot-brand`, `foot-base`.

The content is injected as **trusted** HTML (first-party, admin-only) — never
put untrusted user input in these files. Scripts won't run anyway (the CSP
allows only the app's own script files).

## Images

Put image files in **`HTML/images/`** and reference them as
**`/content/images/<filename>`**, e.g. `<img src="/content/images/food-drive.jpg" alt="…">`.
Remote `https:` images also work. An optional `HTML/images/logo.png` is shown on
the maintenance screen.

## Tokens

These `{{tokens}}` are filled by the server (HTML-escaped):

| Token | Value |
|---|---|
| `{{appTitle}}` | `config.appTitle` (Mission Men of Anna) |
| `{{orgName}}` | `config.orgName` (Mission Men of Anna Inc) |
| `{{year}}` | current year |
| `{{eventCount}}` | number of upcoming published events |

Unknown tokens are left as-is.

## Window styling (`HTML/windows.json`)

Each section is drawn inside a **window** (panel). The window's *chrome* —
background, outline, size, label — is configured in `windows.json`, separately
from the content. It has a `defaults` block and a `windows` block keyed by
section (`hero`, `mission`, `events`, `involved`, `footer`); each window inherits
`defaults` and overrides only the keys it sets.

| Field | Meaning |
|---|---|
| `background` | any CSS color; `"none"` / `"transparent"` for no fill |
| `borderColor` | outline color; `"transparent"` = invisible but still spaced |
| `borderWidth` | outline thickness in px (`0` = no outline) |
| `borderStyle` | `solid` \| `dashed` \| `dotted` \| `none` |
| `width` | window width as a percent of the page (1–100) |
| `maxWidth` | hard px cap on width |
| `radius` | corner radius in px |
| `shadow` | `true`/`false` — drop shadow |
| `textColor` | override text color (e.g. `"#ffffff"` on a dark window); `null` = inherit |
| `showTag` | `true`/`false` — show the corner label |
| `tag` | corner label text |
| `style` | escape hatch: object of **raw CSS property → value**, applied last |

`style` is deep-merged (defaults' `style` + the window's `style`). Malformed JSON
or missing keys fall back to built-in defaults, so a bad edit never breaks the
page — the affected windows just render with default chrome.

## How it works

`GET /api/content` reads the section files **and `windows.json`** (both
mtime-cached → live but cheap), substitutes tokens, and returns
`{ sections: { hero, mission, events, involved, footer }, windows: { … } }` with
every window fully merged against defaults. The SPA injects each section and
applies its window config as inline styles (`core/window-style.ts`).
