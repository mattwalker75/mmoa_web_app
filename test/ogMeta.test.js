// test/ogMeta.test.js — run with `npm test` (node's built-in runner).
// Open Graph injection must survive String.replace's `$` patterns in DB text.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { injectOgMeta } = require('../helpers/ogMeta');

const INDEX = '<!doctype html><html><head><meta charset="utf-8"><title>App</title><meta name="description" content="old"></head><body>x</body></html>';
const SITE = { siteName: 'Mission Men of Anna', absBase: 'https://example.org' };

test('title / description containing $-patterns are inserted verbatim (escaped)', () => {
  const out = injectOgMeta(INDEX, {
    title: "Chili $'til noon $& $$ $` $1",
    description: "Cook-off $' for $& everyone",
    path: '/events/chili',
    image: '/uploads/events/a.jpg'
  }, SITE);
  assert.match(out, /<title>Chili \$&#39;til noon \$&amp; \$\$ \$` \$1 · Mission Men of Anna<\/title>/);
  assert.match(out, /<meta name="description" content="Cook-off \$&#39; for \$&amp; everyone">/);
  assert.match(out, /<meta property="og:title" content="Chili \$&#39;til noon \$&amp; \$\$ \$` \$1">/);
  assert.match(out, /<meta property="og:url" content="https:\/\/example.org\/events\/chili">/);
  assert.match(out, /<meta property="og:image" content="https:\/\/example.org\/uploads\/events\/a.jpg">/);
  assert.match(out, /<meta name="twitter:card" content="summary_large_image">/);
  // The original head content is intact — no "old" description, no duplicated tail.
  assert.doesNotMatch(out, /content="old"/);
  assert.equal((out.match(/<\/head>/g) || []).length, 1);
  assert.equal((out.match(/<body>x<\/body>/g) || []).length, 1);
});

test('without an image the card is "summary" and absolute URLs pass through', () => {
  const out = injectOgMeta(INDEX, { title: 'T', description: '', path: 'https://other.example/p', image: '' }, SITE);
  assert.match(out, /<meta name="twitter:card" content="summary">/);
  assert.match(out, /<meta property="og:url" content="https:\/\/other.example\/p">/);
  assert.doesNotMatch(out, /og:description/);
  assert.match(out, /content="old"/, 'description meta untouched when meta.description is empty');
});
