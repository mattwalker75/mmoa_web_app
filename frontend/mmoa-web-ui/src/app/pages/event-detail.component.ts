import { Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { EventItem } from '../core/models';
import { longDate, shortDate, timeRange, googleCalendarUrl, icsBlob, pageUrl } from '../core/format';
import { FlyerDialogComponent } from '../shared/flyer-dialog.component';
import { ShareButtonsComponent } from '../shared/share-buttons.component';

/**
 * /events/:slug (EventDetail mockup). The server also injects og: tags for this URL.
 *
 * Phones (≤ 700px, styles.scss "Phones") reorder the page without changing
 * tablet/desktop: title, date and place come first (each with one button:
 * Add to calendar, Directions), then Register & pay; the big flyer is
 * replaced by a "View the flyer" card under the registration band; and once
 * the registration band has scrolled off the top, a slim Register bar stays
 * pinned to the bottom of the screen.
 */
@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [RouterLink, FlyerDialogComponent, ShareButtonsComponent],
  template: `
    <div class="page" [class.has-reg]="!!ev()?.is_upcoming && !!ev()?.registration_url">
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
            <div class="detail-media wide-only">
              <button type="button" class="flyer-btn" (click)="openFlyer()" aria-label="Open the event flyer full size">
                <img [src]="e.flyer_url" [alt]="'Flyer for ' + e.title">
              </button>
              <span class="muted small">Tap the flyer to view it full size or download it.</span>
              <!-- Keeps the column's spacing as it was when the flyer dialog lived here. -->
              <span aria-hidden="true"></span>
            </div>
          }
          <div class="detail-body">
            <div>
              <span class="kicker">{{ e.is_upcoming ? 'Upcoming event' : 'Past event' }}{{ e.city ? ' · ' + e.city + ', TX' : '' }}</span>
              <h1>{{ e.title }}</h1>
              @if (e.summary) { <p class="lede" style="margin:12px 0 0">{{ e.summary }}</p> }
            </div>

            <div class="stat-grid facts">
              <div class="stat">
                <span class="fact-ico phone-only" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16M9 3v4M15 3v4"></path></svg></span>
                <div class="stat-label">When</div>
                <div class="stat-value" style="font-size:19px">{{ day(e) }}</div>
                <div class="stat-sub">{{ hours(e) }}</div>
                @if (e.is_upcoming && e.starts_at) {
                  <button type="button" class="btn btn-outline btn-sm fact-btn phone-only" (click)="addToCalendar(e)">Add to calendar</button>
                  <div class="btn-row wide-only" style="gap:4px 14px">
                    <a [href]="gcal(e)" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:15px">Add to Google Calendar</a>
                    <button type="button" class="link-btn" style="font-size:15px;min-height:0;padding:0" (click)="downloadIcs(e)">Apple / Outlook (.ics)</button>
                  </div>
                }
              </div>
              @if (place(e)) {
                <div class="stat">
                  <span class="fact-ico phone-only" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z"></path><circle cx="12" cy="10" r="2.2"></circle></svg></span>
                  <div class="stat-label">Where</div>
                  <div class="stat-value" style="font-size:19px">{{ e.venue_name || e.city }}</div>
                  <div class="stat-sub">{{ addressLine(e) }}</div>
                  @if (e.map_url) {
                    <a class="wide-only" [href]="e.map_url" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:15px">Open in Maps</a>
                    <a class="btn btn-outline btn-sm fact-btn phone-only" [href]="e.map_url" target="_blank" rel="noopener noreferrer">Directions</a>
                  }
                </div>
              }
            </div>

            @if (e.is_upcoming && e.registration_url) {
              <div class="reg-band" #reg>
                <div style="min-width:0">
                  <div class="t">Register online</div>
                  <div class="s">{{ e.registration_note ? e.registration_note + ' · ' : '' }}secure checkout opens in a new tab</div>
                </div>
                <a class="btn btn-primary" [href]="e.registration_url" target="_blank" rel="noopener noreferrer">{{ e.registration_label || 'Register & pay' }}</a>
              </div>
            }

            @if (e.flyer_url) {
              <button type="button" class="flyer-card phone-only" (click)="openFlyer()">
                <img [src]="e.flyer_url" alt="">
                <span class="fc-text"><b>View the flyer</b><span>Full size, or save it to share</span></span>
                <svg class="fc-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>
              </button>
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
        @if (e.flyer_url) {
          <app-flyer-dialog #flyer [url]="e.flyer_url" [alt]="'Flyer for ' + e.title" [label]="e.title + ' — flyer'" />
        }
        @if (sticky() && e.is_upcoming && e.registration_url) {
          <div class="reg-sticky phone-only" role="region" aria-label="Register">
            <div class="rs-text">
              <div class="rs-title">{{ e.title }}</div>
              <div class="rs-sub">{{ shortDay(e) }}{{ e.registration_note ? ' · ' + e.registration_note : '' }}</div>
            </div>
            <a class="btn btn-primary" [href]="e.registration_url" target="_blank" rel="noopener noreferrer">{{ e.registration_label || 'Register & pay' }}</a>
          </div>
        }
      }
    </div>
  `
})
export class EventDetailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  ev = signal<EventItem | null>(null);
  /** Phones: show the pinned Register bar once the registration band is above the screen. */
  sticky = signal(false);
  private reg = viewChild<ElementRef<HTMLElement>>('reg');
  private flyer = viewChild<FlyerDialogComponent>('flyer');
  state = signal<'loading' | 'ok' | 'missing' | 'error'>('loading');
  private seq = 0;

  constructor() {
    this.route.paramMap.subscribe(p => this.load(p.get('slug') || ''));
  }

  private async load(slug: string) {
    const mine = ++this.seq;
    this.state.set('loading');
    this.sticky.set(false);
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

  @HostListener('window:scroll')
  onScroll() {
    const el = this.reg()?.nativeElement;
    const past = !!el && el.getBoundingClientRect().bottom < 0;
    if (past !== this.sticky()) this.sticky.set(past);
  }

  openFlyer() { this.flyer()?.open(); }

  /** Phones' single "Add to calendar" button: Android → Google Calendar;
   *  everything else gets the .ics file (iPhone opens it in Calendar). */
  addToCalendar(e: EventItem) {
    if (/Android/i.test(navigator.userAgent)) window.open(this.gcal(e), '_blank', 'noopener');
    else this.downloadIcs(e);
  }

  day(e: EventItem) { return longDate(e.starts_at); }
  shortDay(e: EventItem) { return shortDate(e.starts_at); }
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
