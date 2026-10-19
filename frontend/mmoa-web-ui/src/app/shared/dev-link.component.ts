import { Component, Input } from '@angular/core';
import { sameOriginPath } from '../core/dev-link.service';

/**
 * Shows a link the server returned as `devLink` (email.showLinksInBrowser —
 * TESTING / TEMPORARY) so a flow can be finished without email:
 * "Email isn't set up yet — click here to verify". Renders nothing when the
 * link is empty, so pages can drop it in unconditionally.
 */
@Component({
  selector: 'app-dev-link',
  standalone: true,
  template: `
    @if (link) {
      <div class="alert alert-warn dev-link">
        <strong>Email isn't set up yet</strong> —
        <a [href]="href()">click here to {{ action }}</a>.
        <span class="dev-link-note">(Testing mode: this link would normally arrive by email.)</span>
      </div>
    }
  `,
  styles: [`
    .dev-link { text-align: left; }
    .dev-link a { font-weight: 700; text-decoration: underline; }
    .dev-link-note { display: block; font-size: .8rem; opacity: .8; margin-top: 4px; }
  `]
})
export class DevLinkComponent {
  /** The devLink from the API response (absolute URL), or null. */
  @Input() link: string | null | undefined = null;
  /** Verb phrase after "click here to …". */
  @Input() action = 'verify your email';

  href(): string { return this.link ? sameOriginPath(this.link) : ''; }
}
