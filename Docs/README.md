# Documentation

Detailed documentation for `mmoa_web_app`. Start with the root
[README](../README.md) for setup; come here for depth.

- **[architecture.md](architecture.md)** — what the system is, its components, the
  request flow, the no-admin-surface principle, and the database shared with the
  admin console.
- **[configuration.md](configuration.md)** — every `config.json` block, defaults,
  and how secrets are handled.
- **[development.md](development.md)** — build/run loop, the lifecycle scripts,
  the Angular critical-CSS gotcha, and how to test.
- **[database.md](database.md)** — schema overview, SQLite vs MySQL, migrations.
- **[email.md](email.md)** — email transports (console / SMTP / SES), the
  verification flow, and the `showLinksInBrowser` testing bypass.
- **[website-content.md](website-content.md)** — the admin-editable website:
  the `HTML/` section files, image folder, `{{tokens}}` and `windows.json`.
