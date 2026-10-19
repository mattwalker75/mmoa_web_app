import { Injectable, signal } from '@angular/core';

/**
 * Email-verification bypass (TESTING / TEMPORARY).
 *
 * While the server's email.showLinksInBrowser switch is on, the endpoints
 * that email a link (signup, resend-verification, forgot-password) also
 * return it as `devLink`. Signup hands it to the next page (verify-pending)
 * through this tiny in-memory store rather than the URL, so the token never
 * lands in the address bar or browser history. It is cleared once shown and
 * never persisted — a reload simply falls back to "Resend email".
 */
@Injectable({ providedIn: 'root' })
export class DevLinkService {
  private readonly pending = signal<string | null>(null);

  set(link: string | null | undefined) { this.pending.set(link || null); }

  /** Read and clear the pending link (one-shot). */
  take(): string | null {
    const link = this.pending();
    this.pending.set(null);
    return link;
  }
}

/**
 * The server builds devLink from publicBaseUrl, which may not be the origin
 * this page is on (e.g. the Angular dev server on :4200). The SPA route is
 * the same either way, so reduce it to path + query and stay on this origin.
 */
export function sameOriginPath(link: string): string {
  try {
    const u = new URL(link, window.location.origin);
    return u.pathname + u.search;
  } catch {
    return link;
  }
}
