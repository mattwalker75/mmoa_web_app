/**
 * Date/time formatting for events and raffles. Everything happens in Anna,
 * TX, so times are always shown in Central time (America/Chicago) no matter
 * where the visitor's device is. The API sends ISO-8601 UTC.
 */
export const SITE_TZ = 'America/Chicago';

function fmt(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: SITE_TZ, ...opts }).format(d);
}

/** "Saturday, December 5, 2026" */
export const longDate = (iso: string | null | undefined) => fmt(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
/** "December 5, 2026" */
export const mediumDate = (iso: string | null | undefined) => fmt(iso, { month: 'long', day: 'numeric', year: 'numeric' });
/** "Sat, Dec 5" */
export const shortDate = (iso: string | null | undefined) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
/** "9:00 AM" */
export const time = (iso: string | null | undefined) => fmt(iso, { hour: 'numeric', minute: '2-digit' });

/** "9:00 AM – 3:00 PM" (or just the start time). */
export function timeRange(start: string | null, end: string | null): string {
  const a = time(start);
  if (!end) return a;
  const sameDay = fmt(start, { year: 'numeric', month: 'numeric', day: 'numeric' }) === fmt(end, { year: 'numeric', month: 'numeric', day: 'numeric' });
  return sameDay ? `${a} – ${time(end)}` : `${a} – ${shortDate(end)} ${time(end)}`;
}

/** Google Maps search link for a free-text place. */
export function mapsUrl(text: string): string {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(text);
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Google Calendar "add event" link (end defaults to start + 2 h). */
export function googleCalendarUrl(title: string, startIso: string, endIso: string | null, location: string, details: string): string {
  const s = new Date(startIso);
  const e = endIso ? new Date(endIso) : new Date(s.getTime() + 2 * 3600 * 1000);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${icsStamp(s)}/${icsStamp(e)}`, details, location });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

/** RFC 5545 line folding: no line over 75 octets; continuation lines start
 *  with a space. Splits at character boundaries, so a multi-byte character
 *  is never cut in half (a line can then end a few octets short). */
function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '', len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > 75 - (out.length ? 1 : 0)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** A one-event .ics file (Apple Calendar / Outlook) as a Blob. */
export function icsBlob(uid: string, title: string, startIso: string, endIso: string | null, location: string, url: string): Blob {
  const s = new Date(startIso);
  const e = endIso ? new Date(endIso) : new Date(s.getTime() + 2 * 3600 * 1000);
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mission Men of Anna//Events//EN', 'BEGIN:VEVENT',
    `UID:${uid}@missionmenofanna`, `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(s)}`, `DTEND:${icsStamp(e)}`,
    `SUMMARY:${esc(title)}`, `LOCATION:${esc(location)}`, `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR'
  ].map(icsFold).join('\r\n');
  return new Blob([body], { type: 'text/calendar;charset=utf-8' });
}

/** This page's address for sharing / calendar links — without the console's
 *  ?preview= token, which must never leave the admin's browser. */
export function pageUrl(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete('preview');
  return u.toString();
}

/** A whole number with thousands separators: 50000 → "50,000". Blank for null. */
export const count = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n))) ? '' : Number(n).toLocaleString('en-US');
