# Email

All email is **outbound-only** and sent through `helpers/email.js`. The `from`
address is a no-reply sender; the optional `replyTo` is set as the Reply-To
header **and** appended to every email body so recipients know where to reach a
human.

## Transports (`config.email.transport`)

- **`console`** (default) — prints the message (and its link) to the server's
  stdout, i.e. `logs/app.log`. No mail is actually sent.
- **`smtp`** — sends via the `email.smtp.*` block using `nodemailer`.
- **`ses`** — sends via **AWS SES v2** (`SendEmail`), using the **`aws` block**
  credentials (the EC2 instance profile when `aws.runningInAws` is true) and
  `aws.region`. The SDK (`@aws-sdk/client-sesv2`) is lazy-loaded, so the app
  boots without it. This is the app's only use of AWS.

```jsonc
"email": {
  "transport": "console",              // "smtp" or "ses" once email is set up
  "from": "noreply@example.org",       // no-reply sender (does not receive mail)
  "replyTo": "info@example.org",
  "showLinksInBrowser": true,          // TESTING / TEMPORARY — see below
  "smtp": { "host": "", "port": 587, "secure": false, "user": "", "password": "" }
}
```

## Emails sent

| Email | When | Notes |
|---|---|---|
| Verify your email address | signup + resend | Link `${publicBaseUrl}/verify?token=…`; expiry from `security.verificationLinkExpiresMinutes` (default 60) |
| Reset your password | forgot-password | Link `${publicBaseUrl}/reset-password?token=…`; single-use; expiry from `passwordResetTokenTtlHours` (default 2) |

Subjects are prefixed with `appTitle`, e.g. `Mission Men of Anna: Verify your email address`.
A failed send is logged and never fails the request (the account is already
created; the member can use "Resend email").

## Verification flow

`POST /api/auth/signup` creates the `member`, inserts an
`email_verification_tokens` row and emails the link. `POST /api/auth/verify`
consumes the token and stamps `users.email_verified_at`.
`POST /api/auth/resend-verification` issues a fresh link. Members can't sign in
until verified (login answers 403 `code: 'unverified'` and the SPA sends them to
the "Check your email" page).

## The testing bypass: `email.showLinksInBrowser` (TESTING / TEMPORARY)

Email isn't set up yet, so the committed `config.json` turns this on (the code
default is `false`). When `true`:

- signup, resend-verification and forgot-password **also** return the link they
  just emailed as **`devLink`** in their JSON response;
- the SPA shows it on screen — *"Email isn't set up yet — click here to verify
  your email"* on the Check-your-email page (after signup or Resend) and
  *"… click here to choose a new password"* on the forgot-password page;
- the email is **still sent** through the configured transport;
- the server logs a loud boot warning;
- `GET /api/public/config` reports `showLinksInBrowser: true`.

While it is on, anyone who knows an email address can verify it or reset that
account's password, and resend/forgot stop being enumeration-safe. **Turn it off
as soon as real email works** — admin console → Web App Settings → Email (then
restart the app).

## Going live with SES

1. Verify the sending **domain identity** in SES (and DKIM).
2. Move the account **out of the SES sandbox** (otherwise only verified
   recipients receive mail).
3. Give the instance role `ses:SendEmail` for the from-address.
4. Set `email.transport: "ses"`, `aws.runningInAws: true`, the real `from` /
   `replyTo` and `publicBaseUrl`, and `email.showLinksInBrowser: false`.
5. Restart the app.
