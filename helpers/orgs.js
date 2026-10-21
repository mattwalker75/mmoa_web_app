// helpers/orgs.js — load nonprofit profiles and shape them for output.
//
// One loader (loadOrgs) pulls organizations + contacts + images + categories
// + cities in five queries for any set of org ids. Two shapers sit on top:
//   publicOrg(o)  — what the "Need Help?" directory may show: only the keys
//                   listed in the org's public_fields, name always, EIN never.
//                   Callers must ALSO have checked verified + listed.
//   privateOrg(o) — everything, for the org's own portal.
// Keeping both here means the visibility rule lives in exactly one place.

'use strict';

const { renderMarkdownLite } = require('./markdownLite');
const { uploadUrl } = require('./uploads');
const { isoOrNull } = require('./sqlTime');

// Every field key an org can show or hide (organizations.public_fields).
const PUBLIC_FIELD_KEYS = [
  'address', 'phone', 'public_email', 'website_url', 'facebook_url', 'instagram_url',
  'other_social_url', 'description', 'hours', 'what_to_bring', 'contacts', 'images',
  'service_cities', 'categories'
];
const MAX_ORG_IMAGES = 5;

/** organizations.public_fields (JSON text) → Set of known keys. NULL or
 *  malformed → everything public (the column default). */
function parsePublicFields(raw) {
  let arr = null;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
  }
  if (!Array.isArray(arr)) arr = PUBLIC_FIELD_KEYS;
  return new Set(arr.filter(k => PUBLIC_FIELD_KEYS.includes(k)));
}

function lines(text) {
  return String(text || '').split(/\r?\n/).map(l => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
}

function addressText(o) {
  const cityLine = [o.city, [o.state, o.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [o.address_line1, o.address_line2, cityLine].filter(Boolean).join(', ');
}

/** Google Maps search link for a free-text address (null when empty). */
function mapsSearchUrl(text) {
  const q = String(text || '').trim();
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : null;
}

function placeholders(n) { return new Array(n).fill('?').join(','); }

/**
 * Load full org records (with children) for the given ids, in id order.
 * Returns an array of plain objects; unknown ids are skipped.
 */
async function loadOrgs(db, ids) {
  const orgIds = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!orgIds.length) return [];
  const ph = placeholders(orgIds.length);
  const [orgs, contacts, images, cats, cities] = await Promise.all([
    db.allAsync(`SELECT * FROM organizations WHERE org_id IN (${ph}) ORDER BY org_id`, orgIds),
    db.allAsync(`SELECT * FROM org_contacts WHERE org_id IN (${ph}) ORDER BY sort, contact_id`, orgIds),
    db.allAsync(`SELECT * FROM org_images WHERE org_id IN (${ph}) ORDER BY sort, image_id`, orgIds),
    db.allAsync(`SELECT oc.org_id, c.category_id, c.slug, c.name, c.is_active
                   FROM org_categories oc JOIN categories c ON c.category_id = oc.category_id
                  WHERE oc.org_id IN (${ph}) ORDER BY c.sort, c.name`, orgIds),
    db.allAsync(`SELECT oc.org_id, c.city_id, c.name, c.is_active
                   FROM org_cities oc JOIN cities c ON c.city_id = oc.city_id
                  WHERE oc.org_id IN (${ph}) ORDER BY c.sort, c.name`, orgIds)
  ]);
  const by = (rows) => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.org_id)) m.set(r.org_id, []); m.get(r.org_id).push(r); }
    return m;
  };
  const cMap = by(contacts), iMap = by(images), catMap = by(cats), cityMap = by(cities);
  return orgs.map(o => ({
    ...o,
    _contacts: cMap.get(o.org_id) || [],
    _images: iMap.get(o.org_id) || [],
    _categories: catMap.get(o.org_id) || [],
    _cities: cityMap.get(o.org_id) || []
  }));
}

/** Is this org allowed to appear publicly at all? */
function isPublic(o) {
  return !!o && o.verification_status === 'verified' && Number(o.is_listed) === 1;
}

/** Public directory shape. Hidden fields are ABSENT (not null). */
function publicOrg(o) {
  const pf = parsePublicFields(o.public_fields);
  const out = { org_id: o.org_id, name: o.name, verified: true };
  if (pf.has('address')) {
    const text = addressText(o);
    if (text) {
      out.address = {
        line1: o.address_line1 || null, line2: o.address_line2 || null,
        city: o.city || null, state: o.state || null, zip: o.zip || null, text
      };
      out.map_url = mapsSearchUrl(text);
    }
  }
  for (const k of ['phone', 'public_email', 'website_url', 'facebook_url', 'instagram_url', 'other_social_url', 'hours']) {
    if (pf.has(k) && o[k]) out[k] = o[k];
  }
  if (out.phone && o.phone_ext) out.phone_ext = o.phone_ext;
  if (pf.has('description') && o.description_md) out.description_html = renderMarkdownLite(o.description_md);
  if (pf.has('what_to_bring')) {
    const list = lines(o.what_to_bring);
    if (list.length) out.what_to_bring = list;
  }
  if (pf.has('contacts')) {
    const list = o._contacts.filter(c => Number(c.is_public) === 1 && (c.name || c.email || c.phone))
      .map(c => ({ name: c.name || null, role: c.role || null, email: c.email || null, phone: c.phone || null, phone_ext: (c.phone && c.phone_ext) || null }));
    if (list.length) out.contacts = list;
  }
  if (pf.has('images')) {
    const list = o._images.map(i => ({ url: uploadUrl(i.path), alt: i.alt || '' })).filter(i => i.url);
    if (list.length) out.images = list;
  }
  if (pf.has('service_cities')) {
    const list = o._cities.filter(c => Number(c.is_active) === 1).map(c => c.name);
    if (list.length) out.service_cities = list;
  }
  if (pf.has('categories')) {
    const list = o._categories.filter(c => Number(c.is_active) === 1).map(c => ({ slug: c.slug, name: c.name }));
    if (list.length) out.categories = list;
  }
  return out;
}

/** Text a keyword search may match: PUBLIC fields only, lowercased. */
function publicSearchText(o) {
  const p = publicOrg(o);
  return [
    p.name, p.address && p.address.text, p.hours,
    o.description_md && p.description_html ? o.description_md : '',
    (p.what_to_bring || []).join(' '),
    (p.categories || []).map(c => c.name).join(' '),
    (p.service_cities || []).join(' ')
  ].filter(Boolean).join(' \n ').toLowerCase();
}

/** Full shape for the org's own portal (includes hidden fields + status). */
function privateOrg(o) {
  return {
    org_id: o.org_id,
    name: o.name,
    ein: o.ein || '',
    address_line1: o.address_line1 || '',
    address_line2: o.address_line2 || '',
    city: o.city || '',
    state: o.state || '',
    zip: o.zip || '',
    phone: o.phone || '',
    phone_ext: o.phone_ext || '',
    public_email: o.public_email || '',
    website_url: o.website_url || '',
    facebook_url: o.facebook_url || '',
    instagram_url: o.instagram_url || '',
    other_social_url: o.other_social_url || '',
    description_md: o.description_md || '',
    hours: o.hours || '',
    what_to_bring: o.what_to_bring || '',
    public_fields: [...parsePublicFields(o.public_fields)],
    is_listed: Number(o.is_listed) === 1,
    verification_status: o.verification_status || 'unverified',
    verified_at: isoOrNull(o.verified_at),
    created_at: isoOrNull(o.created_at),
    updated_at: isoOrNull(o.updated_at),
    contacts: o._contacts.map(c => ({
      contact_id: c.contact_id, name: c.name || '', role: c.role || '', email: c.email || '',
      phone: c.phone || '', phone_ext: c.phone_ext || '', is_public: Number(c.is_public) === 1
    })),
    images: o._images.map(i => ({ image_id: i.image_id, url: uploadUrl(i.path), alt: i.alt || '', sort: i.sort })),
    categories: o._categories.map(c => c.slug),
    city_ids: o._cities.map(c => c.city_id)
  };
}

module.exports = {
  PUBLIC_FIELD_KEYS, MAX_ORG_IMAGES, parsePublicFields, lines, mapsSearchUrl,
  loadOrgs, isPublic, publicOrg, publicSearchText, privateOrg
};
