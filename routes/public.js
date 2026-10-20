// routes/public.js — the public, no-auth half of the JSON API (mounted by
// routes/api.js under /api). Everything here is read-only.
//
//   GET /api/site                  — org facts + website sections (HTML/, tokens applied)
//   GET /api/content               — legacy alias: { sections } only
//   GET /api/events?when=upcoming|past
//   GET /api/events/:slug
//   GET /api/raffles?status=current|past
//   GET /api/raffles/:slug
//   GET /api/board
//   GET /api/directory/meta
//   GET /api/directory/search?category=<slug>&city=<name|any>&q=<text>
//   GET /api/directory/orgs/:id
//
// Visibility rules (the whole point of this file — keep them here):
//   events   — is_published = 1 only.
//   raffles  — is_published = 1 AND status <> 'draft'; winning_ticket only once drawn.
//   orgs     — verification_status = 'verified' AND is_listed = 1 only, and
//              then only the fields in public_fields (helpers/orgs.js). The
//              EIN is never sent. Everything else is a 404 — indistinguishable
//              from "no such org".

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { parseSqlTimeMs, isoOrNull } = require('../helpers/sqlTime');
const { renderMarkdownLite } = require('../helpers/markdownLite');
const { uploadUrl } = require('../helpers/uploads');
const orgsHelper = require('../helpers/orgs');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPCOMING_GRACE_MS = 12 * 3600 * 1000; // an event stays "upcoming" until 12 h after it starts
const PAST_EVENTS_LIMIT = 50;

// Only http(s) links leave the server as clickable URLs (DB values are typed
// in the console; this is defence in depth for href attributes in the SPA).
function safeHttpUrl(u) {
  if (!u || typeof u !== 'string') return null;
  try {
    const p = new URL(u.trim());
    return (p.protocol === 'https:' || p.protocol === 'http:') ? p.toString() : null;
  } catch (e) { return null; }
}

module.exports = function (db, appConfig) {
  const router = express.Router();

  // ── Events ────────────────────────────────────────────────────────────
  // Small table: load published rows and classify/sort in JS with
  // parseSqlTimeMs so ISO-typed values ('2027-05-01T14:00:00Z') and the
  // 'YYYY-MM-DD HH:MM:SS' form behave the same on both engines.
  async function loadPublishedEvents() {
    const rows = await db.allAsync('SELECT * FROM events WHERE is_published = 1');
    const now = Date.now();
    const upcoming = [], past = [];
    for (const r of rows) {
      const start = parseSqlTimeMs(r.starts_at);
      r._start = Number.isFinite(start) ? start : 0;
      (r._start >= now - UPCOMING_GRACE_MS ? upcoming : past).push(r);
    }
    upcoming.sort((a, b) => a._start - b._start);
    past.sort((a, b) => b._start - a._start);
    return { upcoming, past: past.slice(0, PAST_EVENTS_LIMIT) };
  }

  async function beneficiariesFor(eventIds) {
    if (!eventIds.length) return new Map();
    const rows = await db.allAsync(
      `SELECT b.event_id, b.org_id, b.name, b.url, b.sort, o.name AS org_name,
              o.verification_status, o.is_listed
         FROM event_beneficiaries b LEFT JOIN organizations o ON o.org_id = b.org_id
        WHERE b.event_id IN (${eventIds.map(() => '?').join(',')})
        ORDER BY b.sort, b.beneficiary_id`, eventIds);
    const m = new Map();
    for (const r of rows) {
      // Link to the directory profile only while that org is public; never
      // reveal an unverified/unlisted org's name unless the console typed it.
      const orgPublic = r.org_id && orgsHelper.isPublic({ verification_status: r.verification_status, is_listed: r.is_listed });
      const name = r.name || (orgPublic ? r.org_name : null);
      if (!name) continue;
      const item = { name, url: safeHttpUrl(r.url) };
      if (orgPublic) { item.org_id = r.org_id; item.profile_path = `/need-help/org/${r.org_id}`; }
      if (!m.has(r.event_id)) m.set(r.event_id, []);
      m.get(r.event_id).push(item);
    }
    return m;
  }

  function eventLocationText(r) {
    return [r.venue_name, r.address, r.city].filter(Boolean).join(', ');
  }

  function publicEvent(r, beneficiaries, detail) {
    const benefiting = r.beneficiaries_text || (beneficiaries || []).map(b => b.name).join(', ') || null;
    const out = {
      event_id: r.event_id,
      slug: r.slug,
      title: r.title,
      summary: r.summary || '',
      starts_at: isoOrNull(r.starts_at),
      ends_at: isoOrNull(r.ends_at),
      venue_name: r.venue_name || null,
      address: r.address || null,
      city: r.city || null,
      cover_url: uploadUrl(r.cover_path),
      flyer_url: uploadUrl(r.flyer_path),
      registration_url: safeHttpUrl(r.registration_url),
      registration_label: r.registration_label || 'Register & pay',
      registration_note: r.registration_note || null,
      benefiting,
      is_upcoming: r._start >= Date.now() - UPCOMING_GRACE_MS
    };
    if (detail) {
      out.description_html = renderMarkdownLite(r.description_md || '');
      out.map_url = safeHttpUrl(r.map_url) || orgsHelper.mapsSearchUrl(eventLocationText(r));
      out.beneficiaries_text = r.beneficiaries_text || null;
      out.beneficiaries = beneficiaries || [];
    }
    return out;
  }

  router.get('/events', async (req, res) => {
    const when = req.query.when === 'past' ? 'past' : 'upcoming';
    try {
      const sets = await loadPublishedEvents();
      const rows = sets[when];
      const bens = await beneficiariesFor(rows.map(r => r.event_id));
      res.json({ when, events: rows.map(r => publicEvent(r, bens.get(r.event_id), false)) });
    } catch (err) {
      console.error('[api] events list failed:', err);
      res.status(500).json({ error: 'Could not load events' });
    }
  });

  async function findPublishedEvent(slug) {
    if (!SLUG_RE.test(slug || '') || slug.length > 120) return null;
    const r = await db.getAsync('SELECT * FROM events WHERE slug = ? AND is_published = 1', [slug]);
    if (!r) return null;
    const start = parseSqlTimeMs(r.starts_at);
    r._start = Number.isFinite(start) ? start : 0;
    const bens = await beneficiariesFor([r.event_id]);
    return publicEvent(r, bens.get(r.event_id), true);
  }

  router.get('/events/:slug', async (req, res) => {
    try {
      const ev = await findPublishedEvent(req.params.slug);
      if (!ev) return res.status(404).json({ error: 'Event not found' });
      res.json({ event: ev });
    } catch (err) {
      console.error('[api] event detail failed:', err);
      res.status(500).json({ error: 'Could not load this event' });
    }
  });

  // ── Raffles ───────────────────────────────────────────────────────────
  async function raffleImages(raffleIds) {
    if (!raffleIds.length) return new Map();
    const rows = await db.allAsync(
      `SELECT raffle_id, path, alt FROM raffle_images WHERE raffle_id IN (${raffleIds.map(() => '?').join(',')}) ORDER BY sort, image_id`,
      raffleIds);
    const m = new Map();
    for (const r of rows) {
      const url = uploadUrl(r.path);
      if (!url) continue;
      if (!m.has(r.raffle_id)) m.set(r.raffle_id, []);
      m.get(r.raffle_id).push({ url, alt: r.alt || '' });
    }
    return m;
  }

  async function publicRaffles(rows, detail) {
    const imgs = await raffleImages(rows.map(r => r.raffle_id));
    const orgIds = [...new Set(rows.map(r => r.beneficiary_org_id).filter(Boolean))];
    const orgRows = orgIds.length
      ? await db.allAsync(`SELECT org_id, name, verification_status, is_listed FROM organizations WHERE org_id IN (${orgIds.map(() => '?').join(',')})`, orgIds)
      : [];
    const orgMap = new Map(orgRows.map(o => [o.org_id, o]));
    return rows.map(r => {
      const images = imgs.get(r.raffle_id) || [];
      const org = r.beneficiary_org_id ? orgMap.get(r.beneficiary_org_id) : null;
      const orgPublic = org && orgsHelper.isPublic(org);
      const benName = r.beneficiary_text || (orgPublic ? org.name : null);
      const out = {
        raffle_id: r.raffle_id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        image_url: images.length ? images[0].url : uploadUrl(r.flyer_path),
        flyer_url: uploadUrl(r.flyer_path),
        total_tickets: r.total_tickets == null ? null : Number(r.total_tickets),
        ticket_price_text: r.ticket_price_text || null,
        drawing_at: isoOrNull(r.drawing_at),
        drawing_location: r.drawing_location || null,
        beneficiary: benName ? { name: benName, ...(orgPublic ? { org_id: org.org_id, profile_path: `/need-help/org/${org.org_id}` } : {}) } : null,
        winning_ticket: r.status === 'drawn' ? (r.winning_ticket || null) : null
      };
      if (detail) {
        out.prize_html = renderMarkdownLite(r.prize_description_md || '');
        out.images = images;
        out.how_to_buy = r.how_to_buy || '';
        out.claim_requirements = orgsHelper.lines(r.claim_requirements);
        out.claim_preset = r.claim_preset || null;
      }
      return out;
    });
  }

  router.get('/raffles', async (req, res) => {
    const which = req.query.status === 'past' ? 'past' : 'current';
    try {
      const rows = which === 'past'
        ? await db.allAsync("SELECT * FROM raffles WHERE is_published = 1 AND status = 'drawn'")
        : await db.allAsync("SELECT * FROM raffles WHERE is_published = 1 AND status IN ('open','closed')");
      const t = (r) => { const ms = parseSqlTimeMs(r.drawing_at); return Number.isFinite(ms) ? ms : null; };
      rows.sort((a, b) => {
        // current: open before closed, then soonest drawing first (undated last);
        // past: most recent drawing first.
        if (which === 'current' && a.status !== b.status) return a.status === 'open' ? -1 : 1;
        const ta = t(a), tb = t(b);
        if (ta === tb) return b.raffle_id - a.raffle_id;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return which === 'past' ? tb - ta : ta - tb;
      });
      res.json({ status: which, raffles: await publicRaffles(rows.slice(0, 50), false) });
    } catch (err) {
      console.error('[api] raffles list failed:', err);
      res.status(500).json({ error: 'Could not load raffles' });
    }
  });

  async function findPublishedRaffle(slug) {
    if (!SLUG_RE.test(slug || '') || slug.length > 120) return null;
    const r = await db.getAsync("SELECT * FROM raffles WHERE slug = ? AND is_published = 1 AND status <> 'draft'", [slug]);
    if (!r) return null;
    return (await publicRaffles([r], true))[0];
  }

  router.get('/raffles/:slug', async (req, res) => {
    try {
      const raffle = await findPublishedRaffle(req.params.slug);
      if (!raffle) return res.status(404).json({ error: 'Raffle not found' });
      res.json({ raffle });
    } catch (err) {
      console.error('[api] raffle detail failed:', err);
      res.status(500).json({ error: 'Could not load this raffle' });
    }
  });

  // ── Board (About page) ────────────────────────────────────────────────
  router.get('/board', async (req, res) => {
    try {
      const rows = await db.allAsync('SELECT * FROM board_members ORDER BY sort, board_id');
      res.json({
        board: rows.map(b => ({
          board_id: b.board_id,
          role_title: b.role_title,
          role_description: b.role_description || '',
          person_name: b.person_name || null,
          photo_url: uploadUrl(b.photo_path)
        }))
      });
    } catch (err) {
      console.error('[api] board failed:', err);
      res.status(500).json({ error: 'Could not load the board' });
    }
  });

  // ── "Need Help?" directory ────────────────────────────────────────────
  // Keyword search works on words, not raw substrings: lower-cased, accents
  // stripped, split on anything that isn't a letter or digit.
  function tokenize(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter(Boolean);
  }
  // Short query words (VA, GED, ESL, 988) must match a whole word, or "va"
  // would hit "Van Alstyne" and "available". Longer ones match the start of a
  // word, so "dent" finds "dental"/"dentists" and "diaper" finds "diapers".
  function wordMatches(token, word) {
    return word.length <= 3 ? token === word : token.startsWith(word);
  }

  async function activeMeta() {
    const [categories, cities] = await Promise.all([
      db.allAsync('SELECT category_id, slug, name FROM categories WHERE is_active = 1 ORDER BY sort, name'),
      db.allAsync('SELECT city_id, name FROM cities WHERE is_active = 1 ORDER BY sort, name')
    ]);
    return { categories, cities };
  }

  router.get('/directory/meta', async (req, res) => {
    try {
      res.json(await activeMeta());
    } catch (err) {
      console.error('[api] directory meta failed:', err);
      res.status(500).json({ error: 'Could not load categories' });
    }
  });

  async function loadPublicOrgs() {
    const ids = await db.allAsync(
      "SELECT org_id FROM organizations WHERE verification_status = 'verified' AND is_listed = 1");
    return (await orgsHelper.loadOrgs(db, ids.map(r => r.org_id))).filter(orgsHelper.isPublic);
  }

  router.get('/directory/search', async (req, res) => {
    // ?category= takes one slug or several, comma-separated and/or repeated
    // (?category=food,housing or ?category=food&category=housing). An org
    // matches when it helps with ANY selected need.
    const slugs = [...new Set([].concat(req.query.category || [])
      .flatMap(v => String(v).split(','))
      .map(s => s.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    const cityRaw = String(req.query.city || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 200);
    try {
      const meta = await activeMeta();
      const cats = [];
      for (const slug of slugs) {
        const c = meta.categories.find(x => x.slug === slug);
        if (!c) return res.status(400).json({ error: 'Unknown category' });
        cats.push(c);
      }
      let city = null;
      if (cityRaw && cityRaw.toLowerCase() !== 'any') {
        city = meta.cities.find(c => c.name.toLowerCase() === cityRaw.toLowerCase());
        if (!city) return res.status(400).json({ error: 'Unknown city' });
      }
      const words = tokenize(q).slice(0, 10);

      // Matching uses PUBLIC data only — a category, city or text an org has
      // hidden must not make it show up (that would leak the hidden value).
      const results = [];
      const scores = new Map();
      const catHits = new Map();
      for (const o of await loadPublicOrgs()) {
        const p = orgsHelper.publicOrg(o);
        if (cats.length) {
          const hits = cats.filter(c => (p.categories || []).some(pc => pc.slug === c.slug)).length;
          if (!hits) continue;
          catHits.set(p, hits);
        }
        if (city) {
          const name = city.name.toLowerCase();
          const serves = (p.service_cities || []).some(c => c.toLowerCase() === name);
          const basedThere = p.address && (p.address.city || '').toLowerCase() === name;
          if (!serves && !basedThere) continue;
        }
        if (words.length) {
          // Every query word must match a WORD in the public text (not any
          // substring: "rent" must not hit "parents"). Name hits rank above
          // category hits, which rank above description/what-to-bring hits.
          const all = tokenize(orgsHelper.publicSearchText(o));
          const name = tokenize(p.name);
          const cats = tokenize((p.categories || []).map(c => c.name).join(' '));
          let score = 0;
          if (!words.every(w => {
            if (!all.some(t => wordMatches(t, w))) return false;
            score += name.some(t => wordMatches(t, w)) ? 3 : cats.some(t => wordMatches(t, w)) ? 2 : 1;
            return true;
          })) continue;
          scores.set(p, score);
        }
        results.push(p);
      }
      // Orgs covering more of the selected needs first, then keyword
      // relevance, then name.
      results.sort((a, b) =>
        ((catHits.get(b) || 0) - (catHits.get(a) || 0)) ||
        ((scores.get(b) || 0) - (scores.get(a) || 0)) ||
        a.name.localeCompare(b.name));
      res.json({
        categories: cats.map(c => ({ slug: c.slug, name: c.name })),
        // Single-category shape kept for older callers: the first selection.
        category: cats.length ? { slug: cats[0].slug, name: cats[0].name } : null,
        city: city ? city.name : 'any',
        q,
        count: results.length,
        results
      });
    } catch (err) {
      console.error('[api] directory search failed:', err);
      res.status(500).json({ error: 'Search is unavailable right now' });
    }
  });

  router.get('/directory/orgs/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Not found' });
    try {
      const [o] = await orgsHelper.loadOrgs(db, [id]);
      if (!orgsHelper.isPublic(o)) return res.status(404).json({ error: 'Not found' });
      res.json({ org: orgsHelper.publicOrg(o) });
    } catch (err) {
      console.error('[api] directory org failed:', err);
      res.status(500).json({ error: 'Could not load this profile' });
    }
  });

  // ── Website sections (admin-managed HTML/ files) ──────────────────────
  // Each section is an editable HTML fragment in HTML/<key>.html. The admin
  // console edits those files (and drops images in HTML/images/, served at
  // /content/images/). Read with an mtime cache — an edit shows on the next
  // request with no per-request disk cost when unchanged — then {{tokens}}
  // are substituted from config + live data.
  const CONTENT_DIR = path.join(__dirname, '..', 'HTML');
  const SECTION_KEYS = ['hero', 'about', 'help', 'partner', 'footer'];
  const _contentCache = {}; // section -> { mtimeMs, raw }

  function readSectionRaw(section) {
    const file = path.join(CONTENT_DIR, section + '.html');
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return null; }
    const cached = _contentCache[section];
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.raw;
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
    _contentCache[section] = { mtimeMs: stat.mtimeMs, raw };
    return raw;
  }

  function siteFacts() {
    const site = appConfig.site || {};
    return {
      appTitle: appConfig.appTitle || 'Mission Men of Anna',
      orgName: appConfig.orgName || 'Mission Men of Anna Inc',
      phone: site.phone || '',
      ein: site.ein || '',
      facebookUrl: safeHttpUrl(site.facebookUrl) || ''
    };
  }

  async function contentTokens() {
    let eventCount = 0;
    try { eventCount = (await loadPublishedEvents()).upcoming.length; }
    catch (e) { /* token falls back to 0 */ }
    const f = siteFacts();
    // phoneTel: digits only (+1 prefixed for 10-digit US numbers) for tel: links.
    const digits = f.phone.replace(/\D/g, '');
    const phoneTel = digits.length === 10 ? '+1' + digits : digits;
    return { ...f, phoneTel, year: String(new Date().getFullYear()), eventCount: String(eventCount) };
  }

  // Token values are config/DB-derived, so they are HTML-escaped on the way
  // in (an orgName with '&' must not break the markup around it).
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function applyTokens(raw, tokens) {
    return raw.replace(/\{\{(\w+)\}\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(tokens, k) ? escapeHtml(tokens[k]) : m);
  }

  async function renderSections() {
    const tokens = await contentTokens();
    const sections = {};
    for (const key of SECTION_KEYS) {
      const raw = readSectionRaw(key);
      if (raw != null) sections[key] = applyTokens(raw, tokens);
    }
    return sections;
  }

  // Optional real logo: HTML/images/logo.png (or logo.svg) replaces the
  // built-in stand-in SVG in the header when present.
  function logoUrl() {
    for (const f of ['logo.png', 'logo.svg']) {
      try { if (fs.statSync(path.join(CONTENT_DIR, 'images', f)).isFile()) return '/content/images/' + f; }
      catch (e) { /* not there */ }
    }
    return null;
  }

  router.get('/site', async (req, res) => {
    try {
      const f = siteFacts();
      res.json({
        appTitle: f.appTitle,
        orgName: f.orgName,
        phone: f.phone,
        ein: f.ein,
        facebookUrl: f.facebookUrl,
        logoUrl: logoUrl(),
        sections: await renderSections()
      });
    } catch (err) {
      console.error('[api] site load failed:', err);
      res.status(500).json({ error: 'Could not load site content' });
    }
  });

  // Legacy alias (v1 SPA): sections only. windows.json is gone in v2.
  router.get('/content', async (req, res) => {
    try { res.json({ sections: await renderSections() }); }
    catch (err) {
      console.error('[api] content load failed:', err);
      res.status(500).json({ error: 'Could not load content' });
    }
  });

  // Exposed for app.js's Open Graph injection on /events/:slug + /raffles/:slug.
  router.findPublishedEvent = findPublishedEvent;
  router.findPublishedRaffle = findPublishedRaffle;
  return router;
};

module.exports.SECTION_KEYS = ['hero', 'about', 'help', 'partner', 'footer'];
