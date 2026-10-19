import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { SiteHeaderComponent } from './layout/site-header.component';
import { SiteFooterComponent } from './layout/site-footer.component';
import { AuthService } from './core/auth.service';
import { SiteService } from './core/site.service';
import { S } from './core/strings';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  template: `
    @if (booted()) {
      <a class="skip-link" href="#main" (click)="skip($event)">Skip to content</a>
      @if (needHelp()) {
        <div class="emergency-strip" role="note" aria-label="Emergency numbers">
          <div class="container">
            <span><a href="tel:911">{{ S.emergency911 }}</a></span>
            <span><a href="tel:988">{{ S.crisis988 }}</a></span>
            <span><a href="tel:211">{{ S.services211 }}</a></span>
          </div>
        </div>
      }
      <app-site-header />
      <main id="main" tabindex="-1"><router-outlet /></main>
      <app-site-footer [needHelp]="needHelp()" />
    } @else {
      <div class="loading" style="min-height:100vh"><span class="spinner light big" role="status" aria-label="Loading"></span></div>
    }
  `,
  styles: [`main { min-height: calc(100vh - 300px); } main:focus { outline: none; }`]
})
export class App {
  private auth = inject(AuthService);
  private router = inject(Router);
  booted = this.auth.ready; // set by bootstrap(), which runs as an app initializer
  needHelp = signal(false);
  S = S;

  constructor() {
    inject(SiteService).load();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.needHelp.set(this.router.url.startsWith('/need-help'));
    });
  }

  /** In-page skip link without touching the router's URL. */
  skip(e: Event) {
    e.preventDefault();
    const m = document.getElementById('main');
    m?.focus();
    m?.scrollIntoView();
  }
}
