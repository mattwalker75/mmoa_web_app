#!/usr/bin/env node
// scripts/seed-sample-data.js — fill an empty dev/demo site with clearly
// labelled "[Sample]" content so every page has something to show.
//
// Usage:
//   node scripts/seed-sample-data.js            # add (idempotent — re-running adds nothing new)
//   node scripts/seed-sample-data.js --remove   # delete EVERYTHING this script created (+ image files)
//
// Never run automatically (not by START_APP.sh, SETUP_*_DB.sh or the app).
// Stop nothing first — it is safe to run while the app is up.
//
// What it creates (all titles/names start with "[Sample]"):
//   • 3 verified, listed nonprofits, each with its own disabled-password login
//     (login_name sample-org-1..3, email sample-org-N@example.invalid) and
//     categories / cities / a photo
//   • 2 published upcoming events (slugs sample-coyote-cruisers-car-bike-show,
//     sample-chili-cook-off) with cover photos and beneficiaries
//   • 1 published, open shotgun raffle (slug sample-shotgun-raffle) with the
//     photo from scripts/sample/shotgun.jpg and the firearm claim rules
// Images are copied into uploads/ exactly like real uploads (random names).
// --remove identifies rows by those slugs / login names, so it never touches
// real content.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appConfig } = require('../config/appConfig');
const { init: initDb } = require('../db/database');
const { hashPassword } = require('../middleware/auth');
const uploads = require('../helpers/uploads');
const { sqlTime } = require('../helpers/sqlTime');

const ROOT = path.join(__dirname, '..');
const IMG = (f) => path.join(ROOT, 'HTML', 'images', f);

const SAMPLE_ORGS = [
  {
    login: 'sample-org-1', name: '[Sample] Anna Community Food Pantry',
    address_line1: '100 W 4th St', city: 'Anna', zip: '75409', phone: '(972) 555-0101',
    website_url: 'https://example.org/', hours: 'Tue & Thu 9 AM – 12 PM',
    description_md: 'Weekly **groceries** and fresh produce for families in Anna and Melissa.\n\nNo appointment needed.',
    what_to_bring: 'Photo ID\nProof of address (a bill or lease)\nOne visit per week',
    categories: ['food', 'clothing'], cities: ['Anna', 'Melissa'], photo: 'fundraiser.jpg',
    contact: { name: 'Pat Sample', role: 'Pantry director', email: 'pantry@example.org', phone: '(972) 555-0102' }
  },
  {
    login: 'sample-org-2', name: '[Sample] Coyote Packs',
    city: 'Anna', zip: '75409', phone: '(972) 555-0111', hours: 'During the school year',
    description_md: 'Weekend food packs for Anna ISD students who need them.',
    what_to_bring: 'Nothing — ask your school counselor to enroll your child',
    categories: ['food', 'education', 'family'], cities: ['Anna'], photo: 'volunteers.jpg',
    contact: null
  },
  {
    login: 'sample-org-3', name: '[Sample] North Collin Utility Help',
    city: 'Melissa', zip: '75454', phone: '(972) 555-0121', hours: 'Mon–Wed 10 AM – 2 PM',
    description_md: 'One-time help with electric and water bills for households in a hard spot.',
    what_to_bring: 'Your most recent bill\nPhoto ID\nProof of income',
    categories: ['utilities', 'financial'], cities: ['Anna', 'Melissa', 'Van Alstyne'], photo: 'angeltree.jpg',
    contact: null
  }
];

const FIREARM_RULES = [
  'Be the person named on the winning ticket and claim the prize in person',
  'Be of legal age to purchase this firearm (18+ for rifles and shotguns, 21+ for handguns)',
  'Show a valid government-issued photo ID',
  'Complete the transfer through a licensed FFL dealer and pass the federal NICS background check',
  'Not be prohibited by law from owning a firearm',
  'Claim the prize within 30 days of the drawing'
].join('\n');

// A wall-clock time in Anna, TX (America/Chicago) → UTC 'YYYY-MM-DD HH:MM:SS'.
function centralToSql(date, hour, minute) {
  const guess = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return sqlTime(guess + (guess - shown));
}
// The Saturday at least `weeks` weeks from now.
function saturdayIn(weeks) {
  const d = new Date(Date.now() + weeks * 7 * 86400000);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d;
}

async function copyImage(kind, file) {
  const saved = await uploads.saveImage(kind, fs.readFileSync(file), appConfig);
  return saved.path;
}

async function add(db) {
  const now = sqlTime(Date.now());
  const orgIds = {};
  for (const o of SAMPLE_ORGS) {
    let u = await db.getAsync('SELECT user_id FROM users WHERE login_name = ?', [o.login]);
    if (!u) {
      // A random, never-revealed password: these logins can't be used.
      const hash = await hashPassword(crypto.randomBytes(24).toString('hex'));
      const ins = await db.runAsync(
        "INSERT INTO users (login_name, email, first_name, last_name, password_hash, is_active, email_verified_at, created_at) VALUES (?, ?, 'Sample', 'Contact', ?, 1, ?, ?)",
        [o.login, `${o.login}@example.invalid`, hash, now, now]);
      u = { user_id: ins.lastID };
    }
    let org = await db.getAsync('SELECT org_id FROM organizations WHERE user_id = ?', [u.user_id]);
    if (org) { orgIds[o.login] = org.org_id; console.log(`= kept ${o.name}`); continue; }
    const ins = await db.runAsync(
      `INSERT INTO organizations (user_id, name, ein, address_line1, city, state, zip, phone, website_url, description_md,
         hours, what_to_bring, is_listed, verification_status, verified_at, verified_by, created_at, updated_at)
       VALUES (?, ?, '00-0000000', ?, ?, 'TX', ?, ?, ?, ?, ?, ?, 1, 'verified', ?, 'sample-data', ?, ?)`,
      [u.user_id, o.name, o.address_line1 || null, o.city, o.zip, o.phone, o.website_url || null, o.description_md,
        o.hours, o.what_to_bring, now, now, now]);
    const orgId = ins.lastID;
    orgIds[o.login] = orgId;
    for (const slug of o.categories) {
      const c = await db.getAsync('SELECT category_id FROM categories WHERE slug = ?', [slug]);
      if (c) await db.runAsync('INSERT INTO org_categories (org_id, category_id) VALUES (?, ?)', [orgId, c.category_id]);
    }
    for (const name of o.cities) {
      const c = await db.getAsync('SELECT city_id FROM cities WHERE name = ?', [name]);
      if (c) await db.runAsync('INSERT INTO org_cities (org_id, city_id) VALUES (?, ?)', [orgId, c.city_id]);
    }
    if (o.contact) {
      await db.runAsync('INSERT INTO org_contacts (org_id, name, role, email, phone, is_public, sort) VALUES (?, ?, ?, ?, ?, 1, 0)',
        [orgId, o.contact.name, o.contact.role, o.contact.email, o.contact.phone]);
    }
    await db.runAsync('INSERT INTO org_images (org_id, path, alt, sort) VALUES (?, ?, ?, 0)',
      [orgId, await copyImage('orgs', IMG(o.photo)), 'Volunteers at work (sample photo)']);
    console.log(`+ added ${o.name} (verified)`);
  }

  const showDay = saturdayIn(6);
  const chiliDay = saturdayIn(10);
  const events = [
    {
      slug: 'sample-coyote-cruisers-car-bike-show', title: '[Sample] 3rd Annual Coyote Cruisers Car & Bike Show',
      summary: 'Classic cars, trucks and bikes, food trucks, music and awards — all for local kids and teachers.',
      description_md: 'Bring your ride or just come look! **Awards** in a dozen classes, food trucks, music and kids\' activities.\n\n- Registration opens at 8 AM\n- Judging 11 AM – 1 PM\n- Awards at 2:30 PM\n\nQuestions? Call (214) 763-5546.',
      starts_at: centralToSql(showDay, 9, 0), ends_at: centralToSql(showDay, 15, 0),
      venue_name: 'Anna Town Square', address: '101 N Powell Pkwy', city: 'Anna',
      registration_url: 'https://example.org/register', registration_label: 'Register & pay',
      registration_note: '$25 entry · day-of registration also available',
      cover: 'carshow.jpg', flyer: 'carshow.jpg', beneficiaries: ['sample-org-2', 'sample-org-1']
    },
    {
      slug: 'sample-chili-cook-off', title: '[Sample] Community Chili Cook-Off Fundraiser',
      summary: 'Taste the best chili in Anna and vote for your favorite.',
      description_md: 'Teams compete for the golden ladle. **$10** tasting kits at the door.',
      starts_at: centralToSql(chiliDay, 12, 0), ends_at: centralToSql(chiliDay, 16, 0),
      venue_name: '3 Nations Brewery', address: '', city: 'Anna',
      registration_url: null, registration_label: 'Register & pay', registration_note: null,
      cover: 'fundraiser.jpg', flyer: null, beneficiaries: ['sample-org-3']
    }
  ];
  for (const e of events) {
    if (await db.getAsync('SELECT event_id FROM events WHERE slug = ?', [e.slug])) { console.log(`= kept ${e.title}`); continue; }
    const ins = await db.runAsync(
      `INSERT INTO events (slug, title, summary, description_md, starts_at, ends_at, venue_name, address, city,
         cover_path, flyer_path, registration_url, registration_label, registration_note, is_published, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'published', ?, ?)`,
      [e.slug, e.title, e.summary, e.description_md, e.starts_at, e.ends_at, e.venue_name, e.address || null, e.city,
        await copyImage('events', IMG(e.cover)), e.flyer ? await copyImage('events', IMG(e.flyer)) : null,
        e.registration_url, e.registration_label, e.registration_note, now, now]);
    let sort = 0;
    for (const login of e.beneficiaries) {
      await db.runAsync('INSERT INTO event_beneficiaries (event_id, org_id, name, sort) VALUES (?, ?, NULL, ?)', [ins.lastID, orgIds[login], sort++]);
    }
    console.log(`+ added ${e.title}`);
  }

  const raffleSlug = 'sample-shotgun-raffle';
  if (await db.getAsync('SELECT raffle_id FROM raffles WHERE slug = ?', [raffleSlug])) {
    console.log('= kept [Sample] shotgun raffle');
  } else {
    const ins = await db.runAsync(
      `INSERT INTO raffles (slug, title, prize_description_md, total_tickets, ticket_price_text, drawing_at, drawing_location,
         claim_requirements, claim_preset, beneficiary_org_id, status, visibility, is_published, created_at, updated_at)
       VALUES (?, ?, ?, 250, '$20 each or 6 for $100', ?, 'at the Chili Cook-Off', ?, 'firearm', ?, 'open', 'published', 1, ?, ?)`,
      [raffleSlug, '[Sample] Over/Under Shotgun Raffle',
        '12-gauge over/under with a walnut stock. **New in box.**\n\nRetail value about $900.',
        centralToSql(chiliDay, 15, 0), FIREARM_RULES, orgIds['sample-org-2'], now, now]);
    await db.runAsync('INSERT INTO raffle_images (raffle_id, path, alt, sort) VALUES (?, ?, ?, 0)',
      [ins.lastID, await copyImage('raffles', path.join(__dirname, 'sample', 'shotgun.jpg')), 'Over/under shotgun leaning on a tree by a lake']);
    console.log('+ added [Sample] Over/Under Shotgun Raffle');
  }
}

async function remove(db) {
  const evs = await db.allAsync("SELECT event_id, title, flyer_path, cover_path FROM events WHERE slug LIKE 'sample-%' AND title LIKE '[Sample]%'");
  for (const e of evs) {
    await db.runAsync('DELETE FROM events WHERE event_id = ?', [e.event_id]);
    await uploads.deleteImage(e.flyer_path); await uploads.deleteImage(e.cover_path);
    console.log(`- removed ${e.title}`);
  }
  const rafs = await db.allAsync("SELECT raffle_id, title, flyer_path FROM raffles WHERE slug LIKE 'sample-%' AND title LIKE '[Sample]%'");
  for (const r of rafs) {
    const imgs = await db.allAsync('SELECT path FROM raffle_images WHERE raffle_id = ?', [r.raffle_id]);
    await db.runAsync('DELETE FROM raffles WHERE raffle_id = ?', [r.raffle_id]);
    for (const i of imgs) await uploads.deleteImage(i.path);
    await uploads.deleteImage(r.flyer_path);
    console.log(`- removed ${r.title}`);
  }
  const users = await db.allAsync("SELECT user_id, login_name FROM users WHERE login_name LIKE 'sample-org-%' AND email LIKE '%@example.invalid'");
  for (const u of users) {
    const imgs = await db.allAsync('SELECT i.path FROM org_images i JOIN organizations o ON o.org_id = i.org_id WHERE o.user_id = ?', [u.user_id]);
    // Explicit child deletes too, in case a MySQL server has FK checks off.
    await db.runAsync('DELETE FROM organizations WHERE user_id = ?', [u.user_id]);
    await db.runAsync('DELETE FROM users WHERE user_id = ?', [u.user_id]);
    for (const i of imgs) await uploads.deleteImage(i.path);
    console.log(`- removed sample nonprofit login ${u.login_name}`);
  }
  if (!evs.length && !rafs.length && !users.length) console.log('Nothing to remove.');
}

async function main() {
  const removing = process.argv.includes('--remove');
  const db = initDb(appConfig);
  await db.migrated;
  if (removing) await remove(db); else await add(db);
  if (db.raw && typeof db.raw.end === 'function') db.raw.end();
  setTimeout(() => process.exit(0), 200);
}

main().catch(err => {
  console.error('[seed-sample-data] failed:', err);
  process.exit(1);
});
