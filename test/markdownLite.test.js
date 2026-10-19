// test/markdownLite.test.js — run with `npm test` (node's built-in runner).
// Formatting rules + the XSS cases the renderer must neutralise.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdownLite: md } = require('../helpers/markdownLite');

test('paragraphs, line breaks, bold, italic', () => {
  assert.equal(md('Hello **big** *world*\nnext line\n\nSecond para'),
    '<p>Hello <strong>big</strong> <em>world</em><br>next line</p>\n<p>Second para</p>');
});

test('bullet lists', () => {
  assert.equal(md('Bring:\n- ID\n- **Proof** of address'),
    '<p>Bring:</p>\n<ul><li>ID</li><li><strong>Proof</strong> of address</li></ul>');
});

test('allowed links get target + rel', () => {
  assert.equal(md('[Register](https://buy.stripe.com/abc?x=1&y=2)'),
    '<p><a href="https://buy.stripe.com/abc?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">Register</a></p>');
  assert.match(md('[Email us](mailto:info@example.org)'), /href="mailto:info@example.org"/);
});

test('empty / null input', () => {
  assert.equal(md(''), '');
  assert.equal(md(null), '');
  assert.equal(md('\n\n  \n'), '');
});

const XSS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](https://a.example/" onmouseover="alert(1))',
  '[x](https://a.example/"onmouseover="alert(1)")',
  '**<svg onload=alert(1)>**',
  '- <iframe src="https://evil.example"></iframe>',
  '[<img src=x onerror=alert(1)>](https://ok.example)',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '[a](vbscript:msgbox(1))'
];

for (const s of XSS) {
  test('XSS neutralised: ' + s, () => {
    const out = md(s);
    // No raw tags other than the ones the renderer emits.
    const tags = out.match(/<\/?([a-z0-9]+)/gi) || [];
    for (const t of tags) assert.match(t, /^<\/?(p|br|strong|em|ul|li|a)$/i, `unexpected tag ${t} in ${out}`);
    // Every href is allowlisted and no event-handler attribute exists.
    for (const [, href] of out.matchAll(/href="([^"]*)"/g)) assert.match(href, /^(https?:\/\/|mailto:)/i);
    assert.doesNotMatch(out, /<[^>]*\son\w+=/i);
    assert.doesNotMatch(out, /href="(javascript|data|vbscript):/i);
  });
}

test('pre-escaped entities stay text (double-escaped)', () => {
  assert.equal(md('&lt;b&gt;'), '<p>&amp;lt;b&amp;gt;</p>');
});
