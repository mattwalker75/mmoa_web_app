/**
 * Formatting + validation for the portal's contact fields. Mirrors the
 * server's helpers/formats.js (which has the final say on save) so people
 * see the clean form as they type / when they leave a field. Normalizers
 * return the clean value, '' for blank, or null when it can't be made valid.
 */

export const US_STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'], ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands']
];

// ── As-you-type formatters (partial input allowed) ────────────────────────
/** '123456789' → '12-3456789' while typing (digits only, max 9). */
export function typeEin(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 9);
  return d.length > 2 ? d.slice(0, 2) + '-' + d.slice(2) : d;
}
/** Progressive '(123) 456-7890' while typing (drops a leading country 1). */
export function typePhone(v: string): string {
  let d = (v || '').replace(/\D/g, '');
  if (d.length > 10 && d[0] === '1') d = d.slice(1);
  d = d.slice(0, 10);
  if (!d) return '';
  if (d.length < 4) return '(' + d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Extension while typing: digits only, max 6. */
export function typeExt(v: string): string { return (v || '').replace(/\D/g, '').slice(0, 6); }

/** Write the formatted value straight back into the input. Needed because
 *  when formatting yields the SAME model value as before (a letter typed, a
 *  5th digit after the dash), Angular sees no change and never repaints the
 *  box — so the stray characters would stay visible. Returns the value. */
export function maskInput(e: Event, fmt: (v: string) => string): string {
  const el = e.target as HTMLInputElement;
  const v = fmt(el.value);
  if (el.value !== v) el.value = v;
  return v;
}

// ── Final normalizers (on leaving a field and before save) ────────────────
export function normalizeEin(v: string): string | null {
  const d = (v || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 9 ? d.slice(0, 2) + '-' + d.slice(2) : null;
}
export function normalizeState(v: string): string | null {
  const s = (v || '').trim();
  if (!s) return 'TX';
  // Accept "TX", "texas", or a picked suggestion like "TX — Texas".
  const code = s.split(/\s+[—-]\s+/)[0];
  const hit = US_STATES.find(([c, n]) => c === code.toUpperCase() || n.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : null;
}
export function formatPhone(v: string): string | null {
  let d = (v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}
export function normalizeExt(v: string): string | null {
  const s = (v || '').trim();
  if (!s) return '';
  return /^\d{1,6}$/.test(s) ? s : null;
}
export function normalizeEmail(v: string): string | null {
  const s = (v || '').trim().toLowerCase();
  if (!s) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}
export function normalizeUrl(v: string): string | null {
  let s = (v || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!/\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}
const FB_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com']);
export function normalizeFacebook(v: string): string | null {
  let s = (v || '').trim();
  if (!s) return '';
  if (/^@?[A-Za-z0-9.\-]{2,80}$/.test(s) && !/\.(com|org|net)$/i.test(s)) s = 'facebook.com/' + s.replace(/^@/, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!FB_HOSTS.has(u.hostname.toLowerCase())) return null;
    const path = u.pathname.replace(/\/+$/, '');
    if (!path) return null;
    if (path === '/profile.php') {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
    }
    return /^\/[A-Za-z0-9.\-_/]+$/.test(path) ? 'https://www.facebook.com' + path : null;
  } catch { return null; }
}
export function normalizeInstagram(v: string): string | null {
  let s = (v || '').trim();
  if (!s) return '';
  let handle: string;
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(s)) handle = s.replace(/^@/, '');
  else {
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      if (!['instagram.com', 'www.instagram.com', 'instagr.am', 'm.instagram.com'].includes(u.hostname.toLowerCase())) return null;
      handle = u.pathname.split('/').filter(Boolean)[0] || '';
    } catch { return null; }
  }
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}

/** Field key → [normalizer, message shown when it can't be made valid]. */
export const FIELD_RULES: Record<string, [(v: string) => string | null, string]> = {
  ein: [normalizeEin, 'EIN must be 9 digits, like 12-3456789.'],
  state: [normalizeState, 'Pick a US state from the list (for example TX).'],
  phone: [formatPhone, 'Enter a 10-digit phone number, like (972) 555-0100.'],
  phone_ext: [normalizeExt, 'Extension is up to 6 digits.'],
  public_email: [normalizeEmail, 'Enter an email like name@example.org.'],
  website_url: [normalizeUrl, 'Enter a web address like https://example.org.'],
  facebook_url: [normalizeFacebook, 'Enter your Facebook page, like facebook.com/yourpage.'],
  instagram_url: [normalizeInstagram, 'Enter your Instagram, like @yourname or instagram.com/yourname.'],
  other_social_url: [normalizeUrl, 'Enter a web address like https://example.org.']
};
