import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { SiteService } from '../core/site.service';
import { EventItem, PublicOrg, Raffle } from '../core/models';
import { count, mediumDate } from '../core/format';
import { CORE_VALUES, PHOTOS } from '../core/site-content';
import { EventCardComponent } from '../shared/event-card.component';
import { NonprofitCarouselComponent } from '../shared/nonprofit-carousel.component';
import { RouteLinksDirective } from '../shared/route-links.directive';

/** Home (Main mockup): hero, 3 upcoming events, current raffle, a sliding strip
 *  of partner nonprofits, story, partner band. */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, EventCardComponent, RouteLinksDirective, NonprofitCarouselComponent],
  template: `
    <section class="hero-sec" appRouteLinks aria-label="Welcome" [innerHTML]="site.section('hero') || ''"></section>

    <section class="home-sec" aria-labelledby="up-h" style="padding-bottom:24px">
      <div class="section-head">
        <h2 id="up-h">Upcoming events</h2>
        <a routerLink="/events">All events →</a>
      </div>
      @if (loading()) {
        <div class="loading"><span class="spinner light big" role="status" aria-label="Loading events"></span></div>
      } @else if (error()) {
        <div class="alert alert-error" role="alert">We couldn't load events just now. Please try again later.</div>
      } @else if (events().length) {
        <div class="card-grid">
          @for (e of events(); track e.event_id) { <app-event-card [ev]="e" /> }
        </div>
      } @else {
        <div class="empty">No upcoming events are posted right now — check back soon@if (site.facebook(); as fb) {, or follow us on
          <a [href]="fb" target="_blank" rel="noopener">Facebook</a>}.</div>
      }
    </section>

    @if (raffle(); as r) {
      <section class="home-sec" aria-labelledby="raffle-h">
        <div class="feature">
          @if (r.image_url) { <img [src]="r.image_url" [alt]="'Raffle prize: ' + r.title"> }
          <div class="body">
            <span class="kicker">{{ r.status === 'open' ? 'Current raffle' : 'Raffle — ticket sales closed' }}</span>
            <h2 id="raffle-h">{{ r.title }}</h2>
            <div class="stat-grid" style="margin:6px 0">
              <div class="stat stat-dark"><div class="stat-label">Drawing</div><div class="stat-value">{{ date(r.drawing_at) || 'To be announced' }}</div></div>
              @if (r.total_tickets) { <div class="stat stat-dark"><div class="stat-label">Total tickets</div><div class="stat-value">{{ count(r.total_tickets) }}</div></div> }
              @if (r.ticket_price_text) { <div class="stat stat-dark"><div class="stat-label">Ticket price</div><div class="stat-value">{{ r.ticket_price_text }}</div></div> }
            </div>
            <p class="soft" style="margin:0">Tickets are sold in person by MMoA members and at our events — never online.</p>
            <a class="btn btn-primary" style="align-self:flex-start;margin-top:6px" [routerLink]="['/raffles', r.slug]">Raffle details &amp; rules</a>
          </div>
        </div>
      </section>
    }

    @if (showNonprofits()) {
      <section class="home-sec" aria-labelledby="np-h" style="padding-bottom:24px">
        <div class="sec-head">
          <div>
            <span class="kicker">Local partners</span>
            <h2 id="np-h" style="margin-top:6px">Nonprofits serving our community</h2>
          </div>
          @if (site.needHelp()) { <a routerLink="/need-help">Find help →</a> }
        </div>
        <app-nonprofit-carousel [orgs]="orgs()" />
      </section>
    }

    <section class="home-sec" aria-label="Our story">
      <div class="story">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="prose" appRouteLinks [innerHTML]="site.section('about') || ''"></div>
          <ul class="tag-row" aria-label="Our core values" style="list-style:none;padding:0;margin:4px 0 0">
            @for (v of values; track v.name) { <li class="tag">{{ v.name }}</li> }
          </ul>
          <a routerLink="/about" style="font-weight:600;margin-top:6px;align-self:flex-start">Our story, board &amp; values →</a>
        </div>
        <div class="photo-grid">
          @for (p of photos; track p.src) { <img [src]="p.src" [alt]="p.alt" loading="lazy"> }
        </div>
      </div>
    </section>

    <section class="partner-band" aria-labelledby="partner-h">
      <div class="container">
        <div style="flex:1 1 520px;min-width:0">
          <h2 id="partner-h">Are you a local nonprofit?</h2>
          <p>Create a free profile so people in need can find what you offer — and so we can partner with you on events that raise money for your cause.</p>
        </div>
        <a class="btn btn-dark btn-lg" routerLink="/partner">Partner with us</a>
      </div>
    </section>
  `
})
export class HomeComponent {
  private api = inject(ApiService);
  site = inject(SiteService);
  events = signal<EventItem[]>([]);
  raffle = signal<Raffle | null>(null);
  loading = signal(true);
  error = signal(false);
  orgs = signal<PublicOrg[]>([]);
  showNonprofits = computed(() => this.orgs().length > 0);
  values = CORE_VALUES;
  photos = [PHOTOS.booth, PHOTOS.volunteers, PHOTOS.fundraiser, PHOTOS.legion];
  date = mediumDate;
  count = count;

  constructor() { this.load(); }

  private async load() {
    const [ev, ra] = await Promise.allSettled([
      firstValueFrom(this.api.events('upcoming')),
      firstValueFrom(this.api.raffles('current'))
    ]);
    if (ev.status === 'fulfilled') this.events.set(ev.value.events.slice(0, 3)); else this.error.set(true);
    if (ra.status === 'fulfilled') this.raffle.set(ra.value.raffles[0] || null);
    this.loading.set(false);
    try { this.orgs.set((await firstValueFrom(this.api.directorySearch({ count: false }))).results); }
    catch { /* no strip — the rest of the page is unaffected */ }
  }
}
