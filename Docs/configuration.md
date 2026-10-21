# Configuration

All runtime settings live in **`config.json`**, loaded and merged with defaults
by `config/appConfig.js` (the single source of truth for every key and its
default). Missing keys fall back to those defaults, so `config.json` only needs
the values you want to override. Keys prefixed with `_` are comments.

> Values are read at startup — **restart the app** (`./RESTART_APP.sh`, or the
> admin console's Restart button) after editing.

## Keys

### Top level
| Key | Default | Purpose |
|---|---|---|
| `port` | `3004` | HTTP(S) port |
| `appTitle` / `appSubtitle` | `Mission Men of Anna` / `""` | Site name shown in the UI and emails |
| `orgName` | `Mission Men of Anna Inc` | Legal name — emails and the `{{orgName}}` website token |
| `publicBaseUrl` | `http://localhost:3004` | Absolute base for emailed links. Must be the URL visitors actually reach (also the base for Open Graph image/page URLs). |
| `sessionKeyMode` / `sessionKeys` | `auto-generate` / `["",""]` | Leave blank — see "Session signing keys" |
| `sessionMaxAgeHours` | `8` | Sign-in lifetime |
| `passwordMinLength` | `8` | Minimum password length |
| `passwordResetTokenTtlHours` | `2` | Reset-link lifetime |
| `allowMemberRegistration` | `true` | Toggle nonprofit sign-up (Partner With Us → create a login) |
| `site.phone` / `site.ein` / `site.facebookUrl` | `(214) 763-5546` / `33-4035685` / `https://www.facebook.com/missionmenofanna` | Public contact facts in the header/footer/pages; returned by `GET /api/site`; also the `{{phone}}`, `{{phoneTel}}`, `{{ein}}`, `{{facebookUrl}}` website tokens |
| `site.donationEnabled` / `site.donationUrl` | `false` / `''` | Optional "Donate" button in the header, opening the donation payment link (e.g. a Stripe Payment Link) in a new tab. Shown only while `donationEnabled` is true AND the link is a valid http(s) URL. Both edited in the admin console under Web App Settings → General, which refuses to enable the button without a valid link. `{{donationUrl}}` token is '' while disabled |
| `uploads.maxMb` | `8` | Largest accepted uploaded image (portal photos; the console enforces the same for its uploads) |
| `maintenanceCommand` | `./scripts/maintenance.sh` | Run by the admin console (cwd = app dir) with `--enable --title --message` / `--disable` / `--status` |

### `server`
`ssl`, `keyPath`, `certPath` (TLS for the app itself; the app refuses to start
if `ssl` is on and the files are missing) and `trustProxy` (default `1`: trust
the first proxy hop so `req.ip` — used by the lockout and rate limits — comes
from `X-Forwarded-For` behind the ALB). Behind the ALB keep `ssl: false`.

### `database`
`engine` = `sqlite` (default; `sqlite.filename` = `mmoa_web_app.db`, relative to
the app directory) | `mysql` (`mysql.host/port/database/user/password/connectionLimit`;
database `mmoa_web_app`, user `mmoa_app`). See [database.md](database.md).

### `email`
Outbound-only. `transport` = `console` | `smtp` | `ses`; `from` (no-reply
sender), `replyTo` (Reply-To header + shown in every email body), the `smtp.*`
block, and **`showLinksInBrowser`** (TESTING / TEMPORARY — see
[email.md](email.md)). Code default `false`; the committed `config.json` sets
it `true` because email isn't set up yet.

### `aws`
SES only: `region`, `runningInAws` (true → EC2 instance profile; leave the keys
blank), `accessKeyId`, `secretAccessKey`. The app never creates or modifies AWS
resources.

### `security`
| Key | Default | Purpose |
|---|---|---|
| `verificationLinkExpiresMinutes` | `60` | Verification-link lifetime |
| `rateLimiting.auth` | `300 s / 10` | Per-IP window over signup / forgot-password / resend-verification / reset-password check |
| `loginLockout` | `enabled, 10 failures, 300 s` | Per-IP and per-account lock after repeated failed logins; success clears both |
| `headers` | `enabled, CSP on` | helmet + Content-Security-Policy |
| `session` | `secure: null, httpOnly, sameSite: strict` | `secure: null` = automatic (Secure whenever HTTPS) |

Every authenticated API call re-reads the account row, so deactivating a login
in the admin console or changing a password ends that login's other sessions
on their next request.

**Session signing keys.** If `sessionKeys` in `config.json` holds two real
values they are used. Otherwise (blank or `<PLACEHOLDER>`) the app uses
**`local-secrets.json`** (`config/localSecrets.js`): generated once on first
boot, mode 0600, gitignored, reused on every restart, never written back into
`config.json`. Deleting it signs every nonprofit out; nothing worse.

## Secrets — do not commit

`config.json` is **tracked on purpose**: the EC2 template in
`mmoa_web_app_infra` clones this repo and `sed`s the committed copy into shape.
So the committed file must stay **scrubbed** (blank or `<PLACEHOLDER>` secrets)
while the copy on a running machine may hold real values. Two local git guards
keep the two from mixing — run once per clone:

```bash
./scripts/git-hooks/install.sh
```

- **skip-worktree on `config.json`** — local edits are invisible to
  `git status` / `git add -A`. To commit a deliberate structural change:
  `git update-index --no-skip-worktree config.json`, scrub, commit, then re-run
  the install script.
- **pre-commit hook** — refuses any commit whose staged content contains an AWS
  access key, a GitHub token, or a Stripe-style secret.

Values that must stay blank in the committed file: `email.smtp.password`,
`aws.accessKeyId`, `aws.secretAccessKey`, `database.mysql.password`,
`sessionKeys`. In production prefer no static secrets on disk at all:
`aws.runningInAws: true` (instance profile).
