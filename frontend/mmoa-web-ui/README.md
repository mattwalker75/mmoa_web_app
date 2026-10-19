# mmoa-web-ui

The Angular single-page app for **mmoa_web_app** (standalone components,
zoneless change detection — same setup as car_show_control_plane's
`frontend/control-plane-ui`).

- `npm start` — dev server on http://localhost:4200 with live reload. `/api`
  and `/content` are proxied to the Express server on http://localhost:3004
  (`proxy.conf.json`), so start the backend too (`../../START_APP.sh`).
- `npm run build` — production build into `dist/mmoa-web-ui/browser`, which
  the Express server serves. From the repo root: `npm run build:frontend`.

Keep `optimization.styles.inlineCritical: false` in `angular.json` — see
`../../Docs/development.md` for why.
