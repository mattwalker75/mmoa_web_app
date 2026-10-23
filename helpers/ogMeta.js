// helpers/ogMeta.js — inject <title> + Open Graph / Twitter tags into the SPA's
// index.html for a shared event / raffle link (app.js uses it on
// /events/:slug and /raffles/:slug). Pure: no I/O, so it is unit-tested.
//
// All replacements use FUNCTION replacers: with a plain string replacement,
// String.replace treats `$&`, `$'`, `` $` `` and `$$` in the replacement as
// patterns, so a title like "Chili $'til noon" (DB text) would be mangled.

'use strict';

const { escapeHtml } = require('../views/escapeHtml');

/**
 * @param {string} html      the SPA index.html
 * @param {object} meta      { title, description, path, image } — path/image
 *                           may be site-relative ('/…') or absolute URLs
 * @param {object} site      { siteName, absBase } — absBase without a trailing '/'
 */
function injectOgMeta(html, meta, { siteName, absBase }) {
  const abs = (u) => (u && u.startsWith('/')) ? absBase + u : u;
  const tags = [
    ['og:type', 'website'], ['og:site_name', siteName], ['og:title', meta.title],
    ['og:description', meta.description], ['og:url', abs(meta.path)], ['og:image', abs(meta.image)]
  ].filter(([, v]) => v).map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v)}">`);
  tags.push(`<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`);
  if (meta.description) {
    html = html.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escapeHtml(meta.description)}">`);
  }
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(meta.title + ' · ' + siteName)}</title>`)
    .replace('</head>', () => tags.join('\n') + '\n</head>');
}

module.exports = { injectOgMeta };
