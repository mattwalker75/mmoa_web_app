import { Component, inject, signal } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, Scroll } from '@angular/router';
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
  private scroller = inject(ViewportScroller);
  private lastPath = '';
  booted = this.auth.ready; // set by bootstrap(), which runs as an app initializer
  needHelp = signal(false);
  S = S;

  constructor() {
    inject(SiteService).load();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.needHelp.set(this.router.url.startsWith('/need-help'));
    });
    this.router.events.pipe(filter((e): e is Scroll => e instanceof Scroll)).subscribe(e => this.handleScroll(e));
  }

  /** After each navigation: Back/Forward returns to where you were, a #link
   *  scrolls to its anchor, a new page starts at the top — and a change to
   *  only the query string (?category=…&q=… on Need Help) leaves the page
   *  where it is, so typing in a search box never jumps you away from it. */
  private handleScroll(e: Scroll) {
    const path = (e.routerEvent instanceof NavigationEnd ? e.routerEvent.urlAfterRedirects : this.router.url).split(/[?#]/)[0];
    const samePage = path === this.lastPath;
    this.lastPath = path;
    this.stopRestore?.(); // a new navigation supersedes any restore loop still running
    if (e.position) this.restore(e.position);
    else if (e.anchor) this.scroller.scrollToAnchor(e.anchor);
    else if (!samePage) this.jump([0, 0]);
  }

  /** Instant, not the site's smooth scrolling: a page change shouldn't glide. */
  private jump([left, top]: [number, number]) { window.scrollTo({ left, top, behavior: 'instant' }); }

  /** Back/Forward: pages load their lists a moment after they appear, so the
   *  page may still be too short to reach the old spot — keep trying for up
   *  to ~1.5s, and stop as soon as the visitor scrolls or types themselves. */
  private stopRestore?: () => void; // cancels the running loop + detaches its listeners
  private restore(pos: [number, number]) {
    let tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    const stop = () => {
      clearTimeout(timer);
      events.forEach(t => window.removeEventListener(t, stop));
      this.stopRestore = undefined;
    };
    this.stopRestore = stop;
    events.forEach(t => window.addEventListener(t, stop, { passive: true }));
    const attempt = () => {
      this.jump(pos);
      if (Math.abs(window.scrollY - pos[1]) > 2 && ++tries < 15) timer = setTimeout(attempt, 100);
      else stop();
    };
    attempt();
  }

  /** In-page skip link without touching the router's URL. */
  skip(e: Event) {
    e.preventDefault();
    const m = document.getElementById('main');
    m?.focus();
    m?.scrollIntoView();
  }
}
