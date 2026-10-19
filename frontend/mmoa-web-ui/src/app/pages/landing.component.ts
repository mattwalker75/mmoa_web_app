import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { EventItem, WindowConfig } from '../core/models';
import { windowStyle } from '../core/window-style';

/**
 * Website home page. Two things are admin-managed, both served by
 * GET /api/content and injected here:
 *   • each section's CONTENT — HTML/<section>.html (with {{tokens}} filled);
 *   • each window's CHROME (background, outline, size, label) — HTML/windows.json,
 *     applied below as inline styles via style()/win().
 * The event cards under the "events" heading are live from the database
 * (GET /api/events). The panel wrappers stay structural in the component.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="sec" id="hero"><div class="panel" [style]="style('hero')">
      @if (win('hero')?.showTag && win('hero')?.tag) { <span class="panel-tag">{{ win('hero')?.tag }}</span> }
      <div [innerHTML]="section('hero')"></div>
    </div></section>

    <section class="sec" id="mission"><div class="panel" [style]="style('mission')">
      @if (win('mission')?.showTag && win('mission')?.tag) { <span class="panel-tag">{{ win('mission')?.tag }}</span> }
      <div [innerHTML]="section('mission')"></div>
    </div></section>

    <!-- EVENTS: heading is admin-editable; the cards are live from the DB -->
    <section class="sec" id="events"><div class="panel" [style]="style('events')">
      @if (win('events')?.showTag && win('events')?.tag) { <span class="panel-tag">{{ win('events')?.tag }}</span> }
      <div [innerHTML]="section('events')"></div>

      @if (loadingEvents()) {
        <p class="muted">Loading events…</p>
      } @else if (upcoming().length) {
        <div class="event-grid">
          @for (e of upcoming(); track e.event_id) {
            <article class="card event-card">
              <div class="event-date">
                <span class="event-month">{{ e.starts_at | date:'MMM' }}</span>
                <span class="event-day">{{ e.starts_at | date:'d' }}</span>
              </div>
              <div class="event-body">
                <h3>{{ e.title }}</h3>
                <div class="event-meta muted">
                  {{ e.starts_at | date:'EEEE, MMMM d, y · h:mm a' }}@if (e.ends_at) { – {{ e.ends_at | date:'h:mm a' }} }
                  @if (e.location) { <br>{{ e.location }} }
                </div>
                @if (e.description) { <p class="event-desc">{{ e.description }}</p> }
              </div>
            </article>
          }
        </div>
      } @else {
        <p class="muted">No upcoming events right now — check back soon.</p>
      }
    </div></section>

    <section class="sec" id="involved"><div class="panel" [style]="style('involved')">
      @if (win('involved')?.showTag && win('involved')?.tag) { <span class="panel-tag">{{ win('involved')?.tag }}</span> }
      <div [innerHTML]="section('involved')"></div>
    </div></section>
  `
})
export class LandingComponent {
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);

  upcoming = signal<EventItem[]>([]);
  loadingEvents = signal(true);
  private sections = signal<Record<string, string>>({});
  private windows = signal<Record<string, WindowConfig>>({});

  constructor() { this.loadContent(); this.loadEvents(); }

  /** Admin-authored HTML for a section. Trusted (first-party, never user input). */
  section(key: string): SafeHtml {
    const html = this.sections()[key];
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : '';
  }

  /** Resolved window chrome for a section (undefined until /api/content loads). */
  win(key: string): WindowConfig | undefined {
    return this.windows()[key];
  }

  style(key: string): Record<string, string> { return windowStyle(this.win(key)); }

  private async loadContent() {
    try {
      const res = await firstValueFrom(this.api.content());
      this.sections.set(res.sections || {});
      this.windows.set(res.windows || {});
    } catch { /* sections render empty if the content API is unavailable */ }
  }

  private async loadEvents() {
    try {
      const res = await firstValueFrom(this.api.events());
      this.upcoming.set((res.events || []).filter(e => e.is_upcoming));
    } catch { /* leave empty → "no upcoming events" */ }
    finally { this.loadingEvents.set(false); }
  }
}
