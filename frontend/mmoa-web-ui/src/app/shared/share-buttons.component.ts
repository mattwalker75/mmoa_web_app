import { Component, Input, signal } from '@angular/core';
import { pageUrl } from '../core/format';

/** "Share this event:" — Facebook share dialog link + copy-link button. */
@Component({
  selector: 'app-share-buttons',
  standalone: true,
  template: `
    <div class="share-row">
      <span style="font-weight:600">{{ label }}</span>
      <a class="btn btn-outline btn-sm" [href]="facebookUrl()" target="_blank" rel="noopener noreferrer">Facebook</a>
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
