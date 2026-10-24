import { Injectable } from '@angular/core';

/** What a visitor did with a nonprofit's profile (POST /api/metrics). Search
 *  appearances are counted on the server; 'view' = the full profile page. */
export type Kind = 'view' | 'call' | 'directions' | 'website' | 'email' | 'facebook' | 'instagram' | 'other_link';

/**
 * Fire-and-forget activity beacons for the "Your profile activity" card in
 * the portal. Events fired in the same tick (one click can only fire one,
 * but a page load could fire several) go out as one request. The beacon is
 * sent with navigator.sendBeacon so it survives the click navigating away
 * (tel:, mailto:, target=_blank) and nothing here ever throws or shows
 * anything — a failed or missing endpoint is simply ignored.
 */
@Injectable({ providedIn: 'root' })
export class MetricsService {
  private queue: { org: number; kind: Kind }[] = [];
  private scheduled = false;

  track(orgId: number, kind: Kind) {
    if (!Number.isInteger(orgId) || orgId <= 0) return;
    this.queue.push({ org: orgId, kind });
    if (this.scheduled) return;
    this.scheduled = true;
    // A microtask runs as soon as the click handler returns — before the
    // browser follows the link — so the batch never waits on navigation.
    queueMicrotask(() => this.flush());
  }

  private flush() {
    this.scheduled = false;
    const events = this.queue.splice(0, 20);
    if (this.queue.length) { this.scheduled = true; queueMicrotask(() => this.flush()); }
    if (!events.length) return;
    const json = JSON.stringify({ events });
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' &&
          navigator.sendBeacon('/api/metrics', new Blob([json], { type: 'application/json' }))) return;
      fetch('/api/metrics', { method: 'POST', keepalive: true, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: json }).catch(() => { /* ignored */ });
    } catch { /* never surface a metrics failure */ }
  }
}
