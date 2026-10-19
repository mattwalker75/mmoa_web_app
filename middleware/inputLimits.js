// middleware/inputLimits.js — per-field body length cap.
// Same pattern as car_show_control_plane. The 16 KB body cap stops bulk DoS;
// this stops a single 9 KB field from sliding into the DB unchallenged.

const DEFAULT_MAX = 1000;

const FIELD_CAPS = {
  email: 255,
  login_name: 100,
  first_name: 100,
  last_name: 100,
  phone_number: 32,
  identifier: 255,
  password: 256,
  current_password: 256,
  new_password: 256,
  confirm_password: 256,
  token: 128,
  appTitle: 100,
  appSubtitle: 200
};

function enforceInputLimits(req, res, next) {
  if (!req.body || typeof req.body !== 'object') return next();
  for (const key of Object.keys(req.body)) {
    const v = req.body[key];
    if (typeof v !== 'string') continue;
    const cap = FIELD_CAPS[key] !== undefined ? FIELD_CAPS[key] : DEFAULT_MAX;
    if (v.length > cap) {
      const msg = `The "${key}" field is too long. Maximum ${cap} characters.`;
      const wantsJson = (req.get('accept') || '').includes('application/json') ||
                        (req.get('x-requested-with') === 'XMLHttpRequest') ||
                        (req.get('content-type') || '').includes('application/json');
      if (wantsJson) return res.status(400).json({ success: false, error: msg });
      return res.status(400).send(
        `<!DOCTYPE html><html><head><title>Input too long</title></head>` +
        `<body style="font-family:system-ui;padding:24px;max-width:520px;margin:auto;">` +
        `<h2>Input too long</h2><p>${msg}</p>` +
        `<p><a href="javascript:history.back()">← Go back</a></p></body></html>`
      );
    }
  }
  next();
}

module.exports = { enforceInputLimits, FIELD_CAPS, DEFAULT_MAX };
