import { Component, Input, inject } from '@angular/core';
import { SiteService } from '../core/site.service';

/**
 * The MMoA mark. Uses HTML/images/logo.png (or logo.svg) when the admin has
 * added one (GET /api/site → logoUrl); otherwise a stand-in eagle-with-M
 * shield SVG drawn like the approved mockup. Decorative next to the
 * "Mission Men of Anna" wordmark, so it carries no alt text of its own.
 */
@Component({
  selector: 'app-logo',
  standalone: true,
  template: `
    @if (site.info().logoUrl; as url) {
      <img [src]="url" alt="" [width]="size" [height]="size" style="object-fit:contain;display:block">
    } @else {
      <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path d="M4 14 L18 20 L24 12 L30 20 L44 14 L36 26 L30 26 L30 36 L24 44 L18 36 L18 26 L12 26 Z" [attr.fill]="color"></path>
        <path d="M20 24 h8 v8 l-4 4 l-4 -4 Z" fill="#18191a"></path>
        <text x="24" y="32" font-size="8" font-weight="800" text-anchor="middle" [attr.fill]="color" font-family="Saira Condensed, sans-serif">M</text>
      </svg>
    }
  `
})
export class LogoComponent {
  site = inject(SiteService);
  @Input() size = 44;
  @Input() color = '#c9cfcc';
}
