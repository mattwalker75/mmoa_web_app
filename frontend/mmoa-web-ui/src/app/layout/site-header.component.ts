import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { NavigationStart, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { SiteService } from '../core/site.service';
import { LogoComponent } from '../shared/logo.component';

/**
 * Site header (every page): logo + wordmark, main nav, nonprofit login (or
 * "My profile" / "Sign out" when signed in), an optional "Donate" button
 * (only when a donation link is set in the admin console) and the green
 * "Need Help?" pill.
 *
 * Tablet / desktop: everything sits in the bar and wraps onto extra rows if it
 * must, so every link stays one tap away.
 *
 * Phones (≤ 700px, see styles.scss "Phones"): the bar shrinks to the logo,
 * the always-visible "Need Help?" pill and a labeled "Menu" button. The menu
 * opens as a full-screen list (a native modal <dialog>, so focus is trapped,
 * Esc closes it and focus returns to the button). Navigating closes it.
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
            <a class="plain wide-only" routerLink="/portal">My profile</a>
            <button type="button" class="plain wide-only" (click)="logout()">Sign out</button>
          } @else {
            <a class="plain wide-only" routerLink="/login">Nonprofit login</a>
          }
          @if (site.info().donationUrl; as url) {
            <a class="btn btn-outline wide-only" [href]="url" target="_blank" rel="noopener">Donate<span class="sr-only"> (opens in a new tab)</span></a>
          }
          @if (site.needHelp()) {
          <a class="btn btn-primary need-pill" routerLink="/need-help" routerLinkActive #rla="routerLinkActive" [attr.aria-current]="rla.isActive ? 'page' : null">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#18191a" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 21s-7-4.5-9-9.5C1.6 7.6 4.6 4 8 4c2 0 3.2 1 4 2.3C12.8 5 14 4 16 4c3.4 0 6.4 3.6 5 7.5-2 5-9 9.5-9 9.5z"></path></svg>
            Need Help?
          </a>
          }
          <button #menuBtn type="button" class="menu-btn phone-only" aria-haspopup="dialog" [attr.aria-expanded]="menuOpen()" (click)="openMenu()">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
            Menu
          </button>
        </div>
      </div>

      <dialog #menu class="menu-sheet" aria-label="Menu" (close)="menuOpen.set(false)" (click)="backdrop($event)">
        <div class="menu-top">
          <a class="brand" routerLink="/" (click)="closeMenu()" aria-label="Mission Men of Anna — home">
            <app-logo [size]="34" />
            <span class="brand-name" aria-hidden="true">Mission Men<small>of Anna</small></span>
          </a>
          <button type="button" class="menu-btn" (click)="closeMenu()" autofocus>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"></path></svg>
            Close
          </button>
        </div>
        <nav class="menu-links" aria-label="Main">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">Home</a>
          <a routerLink="/events" routerLinkActive="active" ariaCurrentWhenActive="page">Events</a>
          <a routerLink="/raffles" routerLinkActive="active" ariaCurrentWhenActive="page">Raffles</a>
          <a routerLink="/about" routerLinkActive="active" ariaCurrentWhenActive="page">About</a>
          <a routerLink="/partner" routerLinkActive="active" ariaCurrentWhenActive="page">Partner With Us</a>
        </nav>
        <div class="menu-actions">
          @if (site.info().donationUrl; as url) {
            <a class="btn btn-outline" [href]="url" target="_blank" rel="noopener">Donate<span class="sr-only"> (opens in a new tab)</span></a>
          }
          @if (auth.isLoggedIn()) {
            <a class="btn btn-outline" routerLink="/portal">My profile</a>
            <button type="button" class="btn btn-outline" (click)="closeMenu(); logout()">Sign out</button>
          } @else {
            <a class="btn btn-outline" routerLink="/login">Nonprofit login</a>
          }
        </div>
        <div class="help-now menu-help">
          <strong>Need help now?</strong><br>
          Emergency: <a href="tel:911">911</a> · Crisis line: <a href="tel:988">988</a><br>
          Other local services: dial <a href="tel:211">211</a>
        </div>
      </dialog>
    </header>
  `
})
export class SiteHeaderComponent {
  auth = inject(AuthService);
  site = inject(SiteService);
  private router = inject(Router);
  menuOpen = signal(false);
  @ViewChild('menu', { static: true }) menu!: ElementRef<HTMLDialogElement>;

  constructor() {
    // Any navigation (a menu link, Back) closes the menu.
    const sub = this.router.events.pipe(filter(e => e instanceof NavigationStart)).subscribe(() => this.closeMenu());
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  openMenu() {
    const d = this.menu.nativeElement;
    if (!d.open) { d.showModal(); this.menuOpen.set(true); }
  }
  closeMenu() {
    const d = this.menu?.nativeElement;
    if (d?.open) d.close();
  }
  /** A tap on the dialog itself (outside its content) closes it. */
  backdrop(e: MouseEvent) { if (e.target === this.menu.nativeElement) this.closeMenu(); }

  /** Leave the page first, then sign out — so the portal's "unsaved
   *  changes" guard still sees a signed-in user and can stop it. */
  async logout() {
    const left = await this.router.navigateByUrl('/');
    if (left === false) return; // the visitor chose to stay (unsaved edits)
    await this.auth.logout();
  }
}
