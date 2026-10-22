// routes/portal.js — the nonprofit's own profile editor (mounted by
// routes/api.js at /api/portal). Every route requires a signed-in account
// with a verified email (requireVerified, passed in from api.js so the
// session re-check logic lives in one place).
//
//   GET    /api/portal/org                — full profile incl. hidden fields + status
//   PUT    /api/portal/org                — update profile (fields present in the body only)
//   POST   /api/portal/org/images         — multipart, field "image" (+ optional "alt"); max 5
//   DELETE /api/portal/org/images/:id     — remove one photo (row + file)
//   PUT    /api/portal/org/images/order   — { order: [image_id…], alt?: { "<image_id>": "text" } }
//
// Ownership: the org is always looked up by the session's user_id — no route
// takes an org id from the client, so one nonprofit can never touch another's
// profile. EIN is editable only while verification_status = 'unverified';
// verification itself happens in the admin console.

'use strict';

const express = require('express');
const multer = require('multer');
const { sqlTime } = require('../helpers/sqlTime');
const uploads = require('../helpers/uploads');
const orgsHelper = require('../helpers/orgs');

const fmt = require('../helpers/formats');
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const MAX_CONTACTS = 10;

class BadInput extends Error { constructor(msg) { super(msg); this.status = 400; } }

function str(body, key, max, { required = false, label = key } = {}) {
  const v = body[key];
  if (v != null && typeof v !== 'string') throw new BadInput(`${label} must be text`);
  const s = (v || '').trim();
  if (required && !s) throw new BadInput(`${label} is required`);
  if (s.length > max) throw new BadInput(`${label} must be ${max} characters or less`);
  return s;
}

module.exports = function (db, appConfig, { requireVerified }) {
  const router = express.Router();
  router.use(requireVerified);

  // The signed-in account's org. Created on first use if the account has none
  // (e.g. an account made by an older scripts/create-member.js).
  async function myOrgId(req) {
    const u = req.session.user;
    const row = await db.getAsync('SELECT org_id FROM organizations WHERE user_id = ?', [u.user_id]);
    if (row) return row.org_id;
    const acct = await db.getAsync('SELECT first_name, last_name FROM users WHERE user_id = ?', [u.user_id]);
    const name = acct ? `${acct.first_name} ${acct.last_name}`.trim() : (u.login_name || 'My organization');
    const now = sqlTime(Date.now());
    try {
      const ins = await db.runAsync(
        "INSERT INTO organizations (user_id, name, state, verification_status, created_at, updated_at) VALUES (?, ?, 'TX', 'unverified', ?, ?)",
        [u.user_id, name, now, now]);
      return ins.lastID;
    } catch (e) {
      // Two first requests raced: the UNIQUE(user_id) loser just re-reads.
      const again = await db.getAsync('SELECT org_id FROM organizations WHERE user_id = ?', [u.user_id]);
      if (again) return again.org_id;
      throw e;
    }
  }

  async function portalPayload(req, orgId) {
    const [o] = await orgsHelper.loadOrgs(db, [orgId]);
    const [acct, categories, cities] = await Promise.all([
      db.getAsync('SELECT login_name, email, first_name, last_name FROM users WHERE user_id = ?', [req.session.user.user_id]),
      db.allAsync('SELECT category_id, slug, name FROM categories WHERE is_active = 1 ORDER BY sort, name'),
      db.allAsync('SELECT city_id, name FROM cities WHERE is_active = 1 ORDER BY sort, name')
    ]);
    return {
      org: orgsHelper.privateOrg(o),
      // Exactly what the public directory shows (or will show, once verified
      // and listed) — the portal's "Preview public profile". isPublic says
      // whether it is live in search right now.
      preview: orgsHelper.publicOrg(o),
      isPublic: orgsHelper.isPublic(o),
      account: acct || null,
      options: {
        categories, cities,
        publicFieldKeys: orgsHelper.PUBLIC_FIELD_KEYS,
        maxImages: orgsHelper.MAX_ORG_IMAGES
      }
    };
  }

  function fail(res, err, what) {
    if (err && err.status === 400) return res.status(400).json({ error: err.message });
    console.error(`[api] portal ${what} failed:`, err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  router.get('/org', async (req, res) => {
    try {
      res.json(await portalPayload(req, await myOrgId(req)));
    } catch (err) { fail(res, err, 'load'); }
  });

  // ── Update profile ────────────────────────────────────────────────────
  // Only keys PRESENT in the body change; arrays (contacts, categories,
  // city_ids) are replaced wholesale when present.
  router.put('/org', async (req, res) => {
    const b = req.body || {};
    try {
      const orgId = await myOrgId(req);
      const cur = await db.getAsync('SELECT ein, verification_status FROM organizations WHERE org_id = ?', [orgId]);
      const set = {};
      const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

      if (has('name')) {
        const name = str(b, 'name', 200, { required: true, label: 'Organization name' });
        if (name.length < 2) throw new BadInput('Organization name is too short');
        set.name = name;
      }
      if (has('ein')) {
        const raw = String(b.ein || '').trim();
        if (raw) {
          const ein = fmt.normalizeEin(raw);
          if (!ein) throw new BadInput('EIN must be 9 digits (for example 12-3456789)');
          if (ein !== (cur.ein || '')) {
            if (cur.verification_status !== 'unverified') {
              throw new BadInput("Your EIN can't be changed after review. Please contact Mission Men of Anna.");
            }
            set.ein = ein;
          }
        }
      }
      for (const [k, max, label] of [['address_line1', 200, 'Address'], ['address_line2', 200, 'Address line 2'],
        ['city', 100, 'City'], ['hours', 1000, 'Hours'], ['what_to_bring', 2000, 'What to bring'],
        ['description_md', 5000, 'Description']]) {
        if (has(k)) set[k] = str(b, k, max, { label }) || null;
      }
      if (has('state')) {
        const st = fmt.normalizeState(str(b, 'state', 40, { label: 'State' }));
        if (!st) throw new BadInput('Please pick a valid US state (for example TX)');
        set.state = st;
      }
      if (has('zip')) {
        const zip = str(b, 'zip', 10, { label: 'ZIP' });
        if (zip && !ZIP_RE.test(zip)) throw new BadInput('ZIP must be 5 digits (or ZIP+4)');
        set.zip = zip || null;
      }
      if (has('phone')) {
        const phone = fmt.formatPhone(str(b, 'phone', 32, { label: 'Phone' }));
        if (phone === null) throw new BadInput('Phone must be a 10-digit US number, like (972) 555-0100');
        set.phone = phone || null;
      }
      if (has('phone_ext')) {
        const ext = fmt.normalizeExt(str(b, 'phone_ext', 10, { label: 'Extension' }));
        if (ext === null) throw new BadInput('Extension must be 1–6 digits');
        set.phone_ext = ext || null;
      }
      // An extension means nothing without the number it belongs to.
      if (has('phone') && !set.phone) set.phone_ext = null;
      if (has('public_email')) {
        const em = fmt.normalizeEmail(str(b, 'public_email', 255, { label: 'Public email' }));
        if (em === null) throw new BadInput('Public email must look like name@example.org');
        set.public_email = em || null;
      }
      for (const [k, norm, msg] of [
        ['website_url', fmt.normalizeUrl, 'Website must be a web address like https://example.org'],
        ['facebook_url', fmt.normalizeFacebook, 'Facebook must be a Facebook page, like facebook.com/yourpage'],
        ['instagram_url', fmt.normalizeInstagram, 'Instagram must be an Instagram account, like instagram.com/yourname or @yourname'],
        ['other_social_url', fmt.normalizeUrl, 'Other link must be a web address like https://example.org']]) {
        if (!has(k)) continue;
        if (b[k] != null && typeof b[k] !== 'string') throw new BadInput('Links must be text');
        const u = norm(b[k]);
        if (u === null) throw new BadInput(msg);
        set[k] = u || null;
      }
      if (has('search_tags')) {
        if (b.search_tags != null && typeof b.search_tags !== 'string') throw new BadInput('Search keywords must be text');
        const tags = fmt.normalizeSearchTags(String(b.search_tags || '').slice(0, 4000));
        if (tags === null) throw new BadInput(`Search keywords: up to ${fmt.MAX_TAGS}, each up to ${fmt.MAX_TAG_LEN} characters`);
        set.search_tags = tags || null;
      }
      if (has('public_fields')) {
        if (!Array.isArray(b.public_fields)) throw new BadInput('public_fields must be a list');
        set.public_fields = JSON.stringify(orgsHelper.PUBLIC_FIELD_KEYS.filter(k => b.public_fields.includes(k)));
      }
      if (has('is_listed')) set.is_listed = b.is_listed ? 1 : 0;

      let contacts = null;
      if (has('contacts')) {
        if (!Array.isArray(b.contacts)) throw new BadInput('contacts must be a list');
        if (b.contacts.length > MAX_CONTACTS) throw new BadInput(`Up to ${MAX_CONTACTS} contacts`);
        contacts = [];
        for (const c of b.contacts) {
          if (!c || typeof c !== 'object') throw new BadInput('Bad contact entry');
          const name = str(c, 'name', 200, { label: 'Contact name' });
          const role = str(c, 'role', 200, { label: 'Contact role' });
          const emailRaw = str(c, 'email', 255, { label: 'Contact email' });
          const phoneRaw = str(c, 'phone', 32, { label: 'Contact phone' });
          const ext = fmt.normalizeExt(str(c, 'phone_ext', 10, { label: 'Contact extension' }));
          const email = fmt.normalizeEmail(emailRaw);
          const phone = fmt.formatPhone(phoneRaw);
          if (!name && !role && !emailRaw && !phoneRaw) continue; // blank row
          if (!name) throw new BadInput('Each contact needs a name');
          if (email === null) throw new BadInput(`Contact email for ${name} must look like name@example.org`);
          if (phone === null) throw new BadInput(`Contact phone for ${name} must be a 10-digit US number`);
          if (ext === null) throw new BadInput(`Contact extension for ${name} must be 1–6 digits`);
          contacts.push({ name, role: role || null, email: email || null, phone: phone || null, phone_ext: (phone && ext) || null, is_public: c.is_public ? 1 : 0 });
        }
      }

      let categoryIds = null;
      if (has('categories')) {
        if (!Array.isArray(b.categories) || b.categories.length > 50) throw new BadInput('categories must be a list');
        const wanted = new Set(b.categories.map(String));
        const rows = await db.allAsync('SELECT category_id, slug FROM categories WHERE is_active = 1');
        categoryIds = rows.filter(r => wanted.has(r.slug)).map(r => r.category_id);
      }
      let cityIds = null;
      if (has('city_ids')) {
        if (!Array.isArray(b.city_ids) || b.city_ids.length > 100) throw new BadInput('city_ids must be a list');
        const wanted = new Set(b.city_ids.map(Number));
        const rows = await db.allAsync('SELECT city_id FROM cities WHERE is_active = 1');
        cityIds = rows.filter(r => wanted.has(r.city_id)).map(r => r.city_id);
      }

      set.updated_at = sqlTime(Date.now());
      await db.transaction(async (tx) => {
        const cols = Object.keys(set); // fixed allowlist built above — never client keys
        await tx.runAsync(`UPDATE organizations SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE org_id = ?`,
          [...cols.map(c => set[c]), orgId]);
        if (contacts) {
          await tx.runAsync('DELETE FROM org_contacts WHERE org_id = ?', [orgId]);
          let i = 0;
          for (const c of contacts) {
            await tx.runAsync('INSERT INTO org_contacts (org_id, name, role, email, phone, phone_ext, is_public, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [orgId, c.name, c.role, c.email, c.phone, c.phone_ext, c.is_public, i++]);
          }
        }
        if (categoryIds) {
          await tx.runAsync('DELETE FROM org_categories WHERE org_id = ?', [orgId]);
          for (const id of categoryIds) await tx.runAsync('INSERT INTO org_categories (org_id, category_id) VALUES (?, ?)', [orgId, id]);
        }
        if (cityIds) {
          await tx.runAsync('DELETE FROM org_cities WHERE org_id = ?', [orgId]);
          for (const id of cityIds) await tx.runAsync('INSERT INTO org_cities (org_id, city_id) VALUES (?, ?)', [orgId, id]);
        }
      });
      res.json({ ok: true, message: 'Your profile has been saved.', ...(await portalPayload(req, orgId)) });
    } catch (err) { fail(res, err, 'save'); }
  });

  // ── Photos ────────────────────────────────────────────────────────────
  // Parsed in memory (≤ uploads.maxMb), sniffed by magic bytes, then written
  // to uploads/orgs/<random>.<ext>. Browsers resize before upload.
  function imageParser(req, res, next) {
    const mw = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: uploads.maxBytes(appConfig), files: 1, fields: 5, fieldSize: 1024, parts: 6 }
    }).single('image');
    mw(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `That image is too large (max ${uploads.maxBytes(appConfig) / 1024 / 1024} MB).` });
      }
      return res.status(400).json({ error: 'Upload one image in the "image" field.' });
    });
  }

  async function imagesPayload(orgId) {
    const rows = await db.allAsync('SELECT image_id, path, alt, sort FROM org_images WHERE org_id = ? ORDER BY sort, image_id', [orgId]);
    return rows.map(i => ({ image_id: i.image_id, url: uploads.uploadUrl(i.path), alt: i.alt || '', sort: i.sort }));
  }

  router.post('/org/images', imageParser, async (req, res) => {
    let saved = null;
    try {
      const orgId = await myOrgId(req);
      if (!req.file) throw new BadInput('Choose an image to upload.');
      const alt = String((req.body && req.body.alt) || '').trim().slice(0, 300);
      const max = orgsHelper.MAX_ORG_IMAGES;
      const pre = await db.getAsync('SELECT COUNT(*) AS n FROM org_images WHERE org_id = ?', [orgId]);
      if (Number(pre.n) >= max) throw new BadInput(`You can have up to ${max} photos. Delete one first.`);

      saved = await uploads.saveImage('orgs', req.file.buffer, appConfig);
      // Re-check inside a transaction (two uploads at once can't both squeeze
      // past the limit): SQLite transactions are serialized in-process; on
      // MySQL the FOR UPDATE row lock on the org does the same.
      const image = await db.transaction(async (tx) => {
        if (db.engine === 'mysql') await tx.getAsync('SELECT org_id FROM organizations WHERE org_id = ? FOR UPDATE', [orgId]);
        const c = await tx.getAsync('SELECT COUNT(*) AS n, MAX(sort) AS s FROM org_images WHERE org_id = ?', [orgId]);
        if (Number(c.n) >= max) throw new BadInput(`You can have up to ${max} photos. Delete one first.`);
        const sort = c.s == null ? 0 : Number(c.s) + 1;
        const ins = await tx.runAsync('INSERT INTO org_images (org_id, path, alt, sort) VALUES (?, ?, ?, ?)', [orgId, saved.path, alt || null, sort]);
        await tx.runAsync('UPDATE organizations SET updated_at = ? WHERE org_id = ?', [sqlTime(Date.now()), orgId]);
        return { image_id: ins.lastID, url: uploads.uploadUrl(saved.path), alt, sort };
      });
      res.status(201).json({ ok: true, image, images: await imagesPayload(orgId) });
    } catch (err) {
      if (saved) uploads.deleteImage(saved.path);
      fail(res, err, 'image upload');
    }
  });

  router.put('/org/images/order', async (req, res) => {
    const order = req.body && req.body.order;
    const alt = (req.body && req.body.alt) || {};
    try {
      if (!Array.isArray(order) || order.length > 20) throw new BadInput('order must be a list of image ids');
      if (typeof alt !== 'object' || Array.isArray(alt)) throw new BadInput('alt must be an object');
      const orgId = await myOrgId(req);
      const mine = new Set((await db.allAsync('SELECT image_id FROM org_images WHERE org_id = ?', [orgId])).map(r => r.image_id));
      const ids = order.map(Number).filter(id => mine.has(id));
      await db.transaction(async (tx) => {
        let i = 0;
        for (const id of ids) await tx.runAsync('UPDATE org_images SET sort = ? WHERE image_id = ? AND org_id = ?', [i++, id, orgId]);
        for (const [k, v] of Object.entries(alt)) {
          const id = Number(k);
          if (!mine.has(id)) continue;
          await tx.runAsync('UPDATE org_images SET alt = ? WHERE image_id = ? AND org_id = ?', [String(v || '').trim().slice(0, 300) || null, id, orgId]);
        }
      });
      res.json({ ok: true, images: await imagesPayload(orgId) });
    } catch (err) { fail(res, err, 'image order'); }
  });

  router.delete('/org/images/:id', async (req, res) => {
    const id = Number(req.params.id);
    try {
      if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Photo not found' });
      const orgId = await myOrgId(req);
      const row = await db.getAsync('SELECT image_id, path FROM org_images WHERE image_id = ? AND org_id = ?', [id, orgId]);
      if (!row) return res.status(404).json({ error: 'Photo not found' });
      await db.runAsync('DELETE FROM org_images WHERE image_id = ? AND org_id = ?', [id, orgId]);
      await uploads.deleteImage(row.path); // best effort
      res.json({ ok: true, images: await imagesPayload(orgId) });
    } catch (err) { fail(res, err, 'image delete'); }
  });

  return router;
};

// Re-exported for routes/api.js (signup EIN) — the rules live in helpers/formats.js.
module.exports.normalizeEin = fmt.normalizeEin;
module.exports.normalizeUrl = fmt.normalizeUrl;
