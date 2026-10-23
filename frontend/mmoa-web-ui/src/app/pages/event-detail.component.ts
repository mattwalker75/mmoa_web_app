import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { EventItem } from '../core/models';
import { longDate, timeRange, googleCalendarUrl, icsBlob, pageUrl } from '../core/format';
import { FlyerDialogComponent } from '../shared/flyer-dialog.component';
import { ShareButtonsComponent } from '../shared/share-buttons.component';

/** /events/:slug (EventDetail mockup). The server also injects og: tags for this URL. */
@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [RouterLink, FlyerDialogComponent, ShareButtonsComponent],
  template: `
    <div class="page">
      @if (ev()?.preview) {
        <div class="preview-banner" role="status">
          <strong>Preview</strong>
          @switch (ev()!.status) {
            @case ('published') { — this event is published and live on the website. }
            @case ('archived') { — this event is <b>archived</b>: it is not on the website. }
            @default { — this event is a <b>draft</b>: it is not on the website yet. }
          }
        </div>
      }
      <a class="back-link" routerLink="/events">← All events</a>
      @if (state() === 'loading') {
        <div class="loading"><span class="spinner light big" role="status" aria-label="Loading event"></span></div>
      } @else if (state() === 'missing') {
        <div class="empty" style="margin-top:20px"><h1 style="font-size:36px">Event not found</h1>
          <p>This event isn't posted (or is no longer posted). See the <a routerLink="/events">current events</a>.</p></div>
      } @else if (state() === 'error') {
        <div class="alert alert-error" role="alert" style="margin-top:20px">We couldn't load this event. Please try again later.</div>
      } @else if (ev(); as e) {
        <!-- Cover photo = the page header (also the event card's picture);
             the flyer sits in the left column. Either can be missing. -->
        @if (e.cover_url) { <img class="detail-cover" [src]="e.cover_url" alt=""> }
        <div class="detail">
          @if (e.flyer_url) {
            <div class="detail-media">
              <button type="button" class="flyer-btn" (click)="flyer.open()" aria-label="Open the event flyer full size">
                <img [src]="e.flyer_url" [alt]="'Flyer for ' + e.title">
              </button>
              <span class="muted small">Tap the flyer to view it full size or download it.</span>
              <app-flyer-dialog #flyer [url]="e.flyer_url" [alt]="'Flyer for ' + e.title" [label]="e.title + ' — flyer'" />
            </div>
          }
          <div class="detail-body">
            <div>
              <span class="kicker">{{ e.is_upcoming ? 'Upcoming event' : 'Past event' }}{{ e.city ? ' · ' + e.city + ', TX' : '' }}</span>
              <h1>{{ e.title }}</h1>
              @if (e.summary) { <p class="lede" style="margin:12px 0 0">{{ e.summary }}</p> }
            </div>

            <div class="stat-grid">
              <div class="stat">
                <div class="stat-label">When</div>
                <div class="stat-value" style="font-size:19px">{{ day(e) }}</div>
                <div class="stat-sub">{{ hours(e) }}</div>
                @if (e.is_upcoming && e.starts_at) {
                  <div class="btn-row" style="gap:4px 14px">
                    <a [href]="gcal(e)" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:15px">Add to Google Calendar</a>
                    <button type="button" class="link-btn" style="font-size:15px;min-height:0;padding:0" (click)="downloadIcs(e)">Apple / Outlook (.ics)</button>
                  </div>
                }
              </div>
              @if (place(e)) {
                <div class="stat">
                  <div class="stat-label">Where</div>
                  <div class="stat-value" style="font-size:19px">{{ e.venue_name || e.city }}</div>
                  <div class="stat-sub">{{ addressLine(e) }}</div>
                  @if (e.map_url) { <a [href]="e.map_url" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:15px">Open in Maps</a> }
                </div>
              }
            </div>

            @if (e.is_upcoming && e.registration_url) {
              <div class="reg-band">
                <div style="min-width:0">
                  <div class="t">Register online</div>
                  <div class="s">{{ e.registration_note ? e.registration_note + ' · ' : '' }}secure checkout opens in a new tab</div>
                </div>
                <a class="btn btn-primary" [href]="e.registration_url" target="_blank" rel="noopener noreferrer">{{ e.registration_label || 'Register & pay' }}</a>
              </div>
            }

            @if (e.description_html) {
              <section><h2>About the event</h2><div class="prose" [innerHTML]="e.description_html"></div></section>
            }

            @if (e.beneficiaries?.length || e.beneficiaries_text) {
              <section>
                <h2>Where the money goes</h2>
                @if (e.beneficiaries_text) { <p class="prose">{{ e.beneficiaries_text }}</p> }
                @if (e.beneficiaries?.length) {
                  <div class="ben-grid">
                    @for (b of e.beneficiaries; track $index) {
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

            <app-share-buttons label="Share this event:" />
          </div>
        </div>
      }
    </div>
  `
})
export class EventDetailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  ev = signal<EventItem | null>(null);
  state = signal<'loading' | 'ok' | 'missing' | 'error'>('loading');
  private seq = 0;

  constructor() {
    this.route.paramMap.subscribe(p => this.load(p.get('slug') || ''));
  }

  private async load(slug: string) {
    const mine = ++this.seq;
    this.state.set('loading');
    try {
      const res = await firstValueFrom(this.api.event(slug, this.route.snapshot.queryParamMap.get('preview')));
      if (mine !== this.seq) return; // a newer load started
      this.ev.set(res.event);
      this.title.setTitle(`${res.event.title} · Mission Men of Anna`);
      this.state.set('ok');
    } catch (err) {
      if (mine === this.seq) this.state.set(err instanceof HttpErrorResponse && err.status === 404 ? 'missing' : 'error');
    }
  }

  day(e: EventItem) { return longDate(e.starts_at); }
  hours(e: EventItem) { return timeRange(e.starts_at, e.ends_at); }
  place(e: EventItem) { return [e.venue_name, e.address, e.city].filter(Boolean).join(', '); }
  addressLine(e: EventItem) { return [e.address, e.city ? `${e.city}, TX` : ''].filter(Boolean).join(', '); }
  gcal(e: EventItem) { return googleCalendarUrl(e.title, e.starts_at!, e.ends_at, this.place(e), pageUrl()); }

  downloadIcs(e: EventItem) {
    const blob = icsBlob('event-' + e.event_id, e.title, e.starts_at!, e.ends_at, this.place(e), pageUrl());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = e.slug + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
