import { Component, Input, signal } from '@angular/core';
import { pageUrl } from '../core/format';

/**
 * "Share this event:" — Facebook share dialog link + copy-link button.
 * Phones whose browser has the native share sheet (navigator.share) get a
 * "Share…" button in place of Facebook, which covers Facebook, Messages and
 * every other app at once (styles.scss "Phones").
 */
@Component({
  selector: 'app-share-buttons',
  standalone: true,
  template: `
    <div class="share-row">
      <span style="font-weight:600">{{ label }}</span>
      @if (canShare) {
        <button type="button" class="btn btn-outline btn-sm phone-only" (click)="share()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12M7 8l5-5 5 5"></path><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"></path></svg>
          Share…
        </button>
      }
      <a class="btn btn-outline btn-sm" [class.wide-only]="canShare" [href]="facebookUrl()" target="_blank" rel="noopener noreferrer">Facebook</a>
      <button type="button" class="btn btn-outline btn-sm" (click)="copy()">Copy link</button>
      <span class="muted small" aria-live="polite">{{ copied() }}</span>
    </div>
  `
})
export class ShareButtonsComponent {
  @Input() label = 'Share:';
  /** Absolute URL to share; defaults to the current page. */
  @Input() url = '';
  copied = signal('');
  readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** The phone's own share sheet. Cancelling it is not an error. */
  async share() {
    try { await navigator.share({ title: document.title, url: this.target() }); }
    catch { /* dismissed, or not allowed — nothing to do */ }
  }

  private target(): string { return this.url || pageUrl(); }
  facebookUrl(): string { return 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(this.target()); }

  async copy() {
    const text = this.target();
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set('Link copied');
    } catch {
      // Clipboard API unavailable (non-HTTPS origin, old browser): fall back
      // to a hidden textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      this.copied.set(ok ? 'Link copied' : 'Copy failed — copy the address bar instead');
    }
    setTimeout(() => this.copied.set(''), 4000);
  }
}
