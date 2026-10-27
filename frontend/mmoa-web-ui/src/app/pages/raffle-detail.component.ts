import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { SiteService } from '../core/site.service';
import { Raffle } from '../core/models';
import { count, mediumDate, time } from '../core/format';
import { FlyerDialogComponent } from '../shared/flyer-dialog.component';
import { ShareButtonsComponent } from '../shared/share-buttons.component';

/**
 * /raffles/:slug (RaffleDetail mockup). The server also injects og: tags for this URL.
 *
 * Phones (≤ 700px, styles.scss "Phones") lay it out like the event page,
 * without changing tablet/desktop: the drawing and the tickets as icon rows,
 * "How to get tickets", then the flyer as a "View the flyer" card (the
 * "View flyer" thumbnail tile is desktop-only; photo thumbnails stay).
 */
@Component({
  selector: 'app-raffle-detail',
  standalone: true,
  imports: [RouterLink, FlyerDialogComponent, ShareButtonsComponent],
  template: `
    <div class="page">
      @if (r()?.preview) {
        <div class="preview-banner" role="status">
          <strong>Preview</strong>
          @switch (r()!.preview_state) {
            @case ('live') { — this raffle is published and live on the website. }
            @case ('archived') { — this raffle is <b>archived</b>: it is not on the website. }
            @default { — this raffle is a <b>draft</b>: it is not on the website yet. }
          }
        </div>
      }
      <a class="back-link" routerLink="/raffles">← All raffles</a>
      @if (state() === 'loading') {
        <div class="loading"><span class="spinner light big" role="status" aria-label="Loading raffle"></span></div>
      } @else if (state() === 'missing') {
        <div class="empty" style="margin-top:20px"><h1 style="font-size:36px">Raffle not found</h1>
          <p>This raffle isn't posted (or is no longer posted). See the <a routerLink="/raffles">current raffles</a>.</p></div>
      } @else if (state() === 'error') {
        <div class="alert alert-error" role="alert" style="margin-top:20px">We couldn't load this raffle. Please try again later.</div>
      } @else if (r(); as r) {
        <div class="detail">
          @if (main(); as m) {
            <div class="detail-media">
              <img class="media-main" [src]="m.url" [alt]="m.alt || ('Raffle prize: ' + r.title)">
              <app-flyer-dialog #flyer [url]="r.flyer_url" [alt]="'Flyer for ' + r.title" [label]="r.title + ' — flyer'" />
              @if ((r.images?.length || 0) > 1 || r.flyer_url) {
                <div class="thumbs" [class.wide-only]="(r.images?.length || 0) <= 1">
                  @if ((r.images?.length || 0) > 1) {
                    @for (img of r.images; track img.url; let i = $index) {
                      <button type="button" [attr.aria-pressed]="sel() === i" [attr.aria-label]="'Prize photo ' + (i + 1)" (click)="sel.set(i)">
                        <img [src]="img.url" alt="">
                      </button>
                    }
                  }
                  @if (r.flyer_url) { <button type="button" class="thumb-text wide-only" (click)="flyer.open()">View flyer</button> }
                </div>
              }
            </div>
          }
          <div class="detail-body">
            <div>
              <span class="chip" [class.chip-muted]="r.status === 'closed'">{{ statusLabel(r) }}</span>
              <h1 style="margin-top:12px">{{ r.title }}</h1>
            </div>

            @if (r.status === 'drawn') {
              <div class="winner" role="status">
                <div class="stat-label" style="color:#c7d8bb">Winning ticket</div>
                <div class="num">{{ r.winning_ticket ? '#' + r.winning_ticket : 'To be posted' }}</div>
                <div class="soft">Drawn {{ date(r.drawing_at) }}. Congratulations to the winner, and thank you to everyone who bought a ticket!</div>
              </div>
            }

            <div class="stat-grid wide-only">
              <div class="stat"><div class="stat-label">Drawing</div><div class="stat-value">{{ date(r.drawing_at) || 'To be announced' }}</div>
                @if (drawSub(r)) { <div class="stat-sub">{{ drawSub(r) }}</div> }</div>
              @if (r.total_tickets) { <div class="stat"><div class="stat-label">Total tickets</div><div class="stat-value">{{ count(r.total_tickets) }}</div></div> }
              @if (r.ticket_price_text) { <div class="stat"><div class="stat-label">Ticket</div><div class="stat-value">{{ r.ticket_price_text }}</div></div> }
            </div>

            <!-- Phones: the event page's icon rows. -->
            <div class="facts phone-only">
              <div class="stat">
                <span class="fact-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16M9 3v4M15 3v4"></path></svg></span>
                <div class="stat-label">Drawing</div>
                <div class="stat-value">{{ r.status === 'drawn' ? 'Drawn ' : '' }}{{ date(r.drawing_at) || 'Drawing date to be announced' }}</div>
                @if (drawSub(r)) { <div class="stat-sub">{{ drawSub(r) }}</div> }
              </div>
              @if (r.ticket_price_text || r.total_tickets) {
                <div class="stat">
                  <span class="fact-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"></path><path d="M14 6v12" stroke-dasharray="2 2.5"></path></svg></span>
                  <div class="stat-label">Tickets</div>
                  <div class="stat-value">{{ r.ticket_price_text || 'Sold in person' }}</div>
                  @if (r.total_tickets) { <div class="stat-sub">{{ count(r.total_tickets) }} tickets total</div> }
                </div>
              }
            </div>

            @if (r.status !== 'drawn') {
              <section class="card card-tight" style="padding:20px 22px">
                <h2 class="plain-h2" style="margin:0 0 8px">How to get tickets</h2>
                <p class="soft" style="margin:0">{{ r.how_to_buy }}@if (site.phone()) { Questions? Call <a [href]="'tel:' + site.phoneTel()">{{ site.phone() }}</a>.}</p>
              </section>
            }

            @if (r.flyer_url) {
              <button type="button" class="flyer-card phone-only" (click)="openFlyer()">
                <img [src]="r.flyer_url" alt="">
                <span class="fc-text"><b>View the flyer</b><span>Full size, or save it to share</span></span>
                <svg class="fc-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>
              </button>
            }

            @if (r.prize_html) { <section><h2>About the prize</h2><div class="prose" [innerHTML]="r.prize_html"></div></section> }

            @if (r.claim_requirements?.length) {
              <section class="claim">
                <h2>To claim this prize, the winner must:</h2>
                <ul>@for (c of r.claim_requirements; track $index) { <li>{{ c }}</li> }</ul>
              </section>
            }

            @if (r.beneficiaries?.length || r.beneficiaries_text) {
              <section>
                <h2>Where the money goes</h2>
                @if (r.beneficiaries_text) { <p class="prose">{{ r.beneficiaries_text }}</p> }
                @if (r.beneficiaries?.length) {
                  <div class="ben-grid">
                    @for (b of r.beneficiaries; track $index) {
                      @if (b.profile_path) {
                        <a class="ben" [routerLink]="b.profile_path">{{ b.name }}</a>
                      } @else if (b.url) {
                        <a class="ben" [href]="b.url" target="_blank" rel="noopener noreferrer">{{ b.name }}<div class="s">Visit website</div></a>
                      } @else {
                        <div class="ben">{{ b.name }}</div>
                      }
                    }
                  </div>
                }
              </section>
            }
            @if (r.status !== 'drawn') { <p class="muted" style="margin:0">After the drawing, this page shows the winning ticket number.</p> }

            <app-share-buttons label="Share this raffle:" />
          </div>
        </div>
      }
    </div>
  `
})
export class RaffleDetailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  site = inject(SiteService);
  r = signal<Raffle | null>(null);
  sel = signal(0);
  state = signal<'loading' | 'ok' | 'missing' | 'error'>('loading');
  date = mediumDate;
  count = count;
  private seq = 0;
  private flyer = viewChild<FlyerDialogComponent>('flyer');
  openFlyer() { this.flyer()?.open(); }

  /** The big photo: the selected prize image, else the flyer. */
  main = computed(() => {
    const r = this.r();
    if (!r) return null;
    const imgs = r.images || [];
    if (imgs.length) return imgs[Math.min(this.sel(), imgs.length - 1)];
    return r.flyer_url ? { url: r.flyer_url, alt: 'Flyer for ' + r.title } : null;
  });

  constructor() {
    this.route.paramMap.subscribe(p => this.load(p.get('slug') || ''));
  }

  private async load(slug: string) {
    const mine = ++this.seq;
    this.state.set('loading');
    this.sel.set(0);
    try {
      const res = await firstValueFrom(this.api.raffle(slug, this.route.snapshot.queryParamMap.get('preview')));
      if (mine !== this.seq) return; // a newer load started
      this.r.set(res.raffle);
      this.title.setTitle(`${res.raffle.title} · Mission Men of Anna`);
      this.state.set('ok');
    } catch (err) {
      if (mine === this.seq) this.state.set(err instanceof HttpErrorResponse && err.status === 404 ? 'missing' : 'error');
    }
  }

  drawSub(r: Raffle) { return [time(r.drawing_at), r.drawing_location].filter(Boolean).join(' · '); }

  statusLabel(r: Raffle) {
    // 'draft' only reaches the page in a console preview.
    return r.status === 'open' ? 'Tickets on sale' : r.status === 'closed' ? 'Ticket sales closed'
      : r.status === 'drawn' ? 'Drawing held' : 'Draft — not on sale yet';
  }
}
