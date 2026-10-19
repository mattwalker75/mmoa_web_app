import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { EventItem } from '../core/models';
import { EventCardComponent } from '../shared/event-card.component';

/** /events — upcoming (soonest first) and past (newest first, last 50). */
@Component({
  selector: 'app-events',
  standalone: true,
  imports: [EventCardComponent],
  template: `
    <div class="page stack">
      <div>
        <span class="kicker">Get out and serve</span>
        <h1>Events</h1>
        <p class="lede">Fundraisers, drives and community days. This page is always the latest word — Facebook posts link back here.</p>
      </div>
      @if (error()) { <div class="alert alert-error" role="alert">We couldn't load events just now. Please try again later.</div> }
      <section aria-labelledby="up-h">
        <h2 id="up-h">Upcoming</h2>
        @if (loading()) {
          <div class="loading"><span class="spinner light big" role="status" aria-label="Loading events"></span></div>
        } @else if (upcoming().length) {
          <div class="card-grid">@for (e of upcoming(); track e.event_id) { <app-event-card [ev]="e" /> }</div>
        } @else {
          <div class="empty">No upcoming events are posted right now — check back soon.</div>
        }
      </section>
      @if (past().length) {
        <section aria-labelledby="past-h" style="margin-top:24px">
          <h2 id="past-h">Past events</h2>
          <div class="card-grid">@for (e of past(); track e.event_id) { <app-event-card [ev]="e" /> }</div>
        </section>
      }
    </div>
  `
})
export class EventsComponent {
  private api = inject(ApiService);
  upcoming = signal<EventItem[]>([]);
  past = signal<EventItem[]>([]);
  loading = signal(true);
  error = signal(false);

  constructor() { this.load(); }
  private async load() {
    const [u, p] = await Promise.allSettled([firstValueFrom(this.api.events('upcoming')), firstValueFrom(this.api.events('past'))]);
    if (u.status === 'fulfilled') this.upcoming.set(u.value.events); else this.error.set(true);
    if (p.status === 'fulfilled') this.past.set(p.value.events);
    this.loading.set(false);
  }
}
