import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Raffle } from '../core/models';
import { mediumDate } from '../core/format';
import { LogoComponent } from '../shared/logo.component';

/** /raffles — current (open / closed) and past (drawn, with winning tickets). */
@Component({
  selector: 'app-raffles',
  standalone: true,
  imports: [RouterLink, LogoComponent],
  template: `
    <div class="page stack">
      <div>
        <span class="kicker">Tickets sold in person only</span>
        <h1>Raffles</h1>
        <p class="lede">Raffle tickets are sold in person by MMoA members and at our events — Texas law doesn't allow raffle tickets to be sold online.</p>
      </div>
      @if (error()) { <div class="alert alert-error" role="alert">We couldn't load raffles just now. Please try again later.</div> }
      <section aria-labelledby="cur-h">
        <h2 id="cur-h">Current raffles</h2>
        @if (loading()) {
          <div class="loading"><span class="spinner light big" role="status" aria-label="Loading raffles"></span></div>
        } @else if (current().length) {
          <div class="card-grid">
            @for (r of current(); track r.raffle_id) {
              <a class="ev-card" [routerLink]="['/raffles', r.slug]">
                @if (r.image_url) { <img [src]="r.image_url" alt="" loading="lazy"> } @else { <div class="img-ph" aria-hidden="true"><app-logo [size]="72" color="#4e5452" /></div> }
                <div class="body">
                  <span class="ev-meta">{{ r.drawing_at ? 'Drawing ' + date(r.drawing_at) : 'Drawing date to be announced' }}</span>
                  <span class="ev-title">{{ r.title }}</span>
                  @if (r.ticket_price_text) { <span class="ev-sub">{{ r.ticket_price_text }}</span> }
                  <span class="chip" [class.chip-muted]="r.status !== 'open'">{{ r.status === 'open' ? 'Tickets on sale' : 'Ticket sales closed' }}</span>
                </div>
              </a>
            }
          </div>
        } @else {
          <div class="empty">No raffles are running right now — check back soon.</div>
        }
      </section>
      @if (past().length) {
        <section aria-labelledby="past-h" style="margin-top:24px">
          <h2 id="past-h">Past drawings</h2>
          <div class="card-grid">
            @for (r of past(); track r.raffle_id) {
              <a class="ev-card" [routerLink]="['/raffles', r.slug]">
                <div class="body">
                  <span class="ev-meta">Drawn {{ date(r.drawing_at) }}</span>
                  <span class="ev-title">{{ r.title }}</span>
                  @if (r.winning_ticket) { <span class="chip">Winning ticket #{{ r.winning_ticket }}</span> }
                </div>
              </a>
            }
          </div>
        </section>
      }
    </div>
  `
})
export class RafflesComponent {
  private api = inject(ApiService);
  current = signal<Raffle[]>([]);
  past = signal<Raffle[]>([]);
  loading = signal(true);
  error = signal(false);
  date = mediumDate;

  constructor() { this.load(); }
  private async load() {
    const [c, p] = await Promise.allSettled([firstValueFrom(this.api.raffles('current')), firstValueFrom(this.api.raffles('past'))]);
    if (c.status === 'fulfilled') this.current.set(c.value.raffles); else this.error.set(true);
    if (p.status === 'fulfilled') this.past.set(p.value.raffles);
    this.loading.set(false);
  }
}
