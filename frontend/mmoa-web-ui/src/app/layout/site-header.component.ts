import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { SiteService } from '../core/site.service';
import { LogoComponent } from '../shared/logo.component';

/**
 * Site header (every page): logo + wordmark, main nav, nonprofit login (or
 * "My profile" / "Sign out" when signed in), an optional "Donate" button
 * (only when a donation link is set in the admin console) and the green
 * "Need Help?" pill.
 * Wraps onto extra rows on narrow screens instead of hiding links behind a
 * menu button, so every link stays one tap away.
 */
@Component({
  selector: 'app-site-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LogoComponent],
  template: `
    <header class="site-header">
      <div class="bar">
        <a class="brand" routerLink="/" aria-label="Mission Men of Anna — home">
          <app-logo [size]="44" />
          <span class="brand-name" aria-hidden="true">Mission Men<small>of Anna</small></span>
        </a>
        <nav class="main-nav" aria-label="Main">
          <a routerLink="/events" routerLinkActive="active" ariaCurrentWhenActive="page">Events</a>
          <a routerLink="/raffles" routerLinkActive="active" ariaCurrentWhenActive="page">Raffles</a>
          <a routerLink="/about" routerLinkActive="active" ariaCurrentWhenActive="page">About</a>
          <a routerLink="/partner" routerLinkActive="active" ariaCurrentWhenActive="page">Partner With Us</a>
        </nav>
        <div class="header-actions">
          @if (auth.isLoggedIn()) {
            <a class="plain" routerLink="/portal">My profile</a>
            <button type="button" class="plain" (click)="logout()">Sign out</button>
          } @else {
            <a class="plain" routerLink="/login">Nonprofit login</a>
          }
          @if (site.info().donationUrl; as url) {
            <a class="btn btn-outline" [href]="url" target="_blank" rel="noopener">Donate<span class="sr-only"> (opens in a new tab)</span></a>
          }
          <a class="btn btn-primary" routerLink="/need-help" routerLinkActive #rla="routerLinkActive" [attr.aria-current]="rla.isActive ? 'page' : null">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#18191a" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 21s-7-4.5-9-9.5C1.6 7.6 4.6 4 8 4c2 0 3.2 1 4 2.3C12.8 5 14 4 16 4c3.4 0 6.4 3.6 5 7.5-2 5-9 9.5-9 9.5z"></path></svg>
            Need Help?
          </a>
        </div>
      </div>
    </header>
  `
})
export class SiteHeaderComponent {
  auth = inject(AuthService);
  site = inject(SiteService);
  private router = inject(Router);

  async logout() {
    await this.auth.logout();
    this.router.navigateByUrl('/');
  }
}
