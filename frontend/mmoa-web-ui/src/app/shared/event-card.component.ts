import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EventItem } from '../core/models';
import { shortDate } from '../core/format';
import { LogoComponent } from './logo.component';

/** Event card (home "Upcoming events" + /events): photo, date · place, title, beneficiaries. */
@Component({
  selector: 'app-event-card',
  standalone: true,
  imports: [RouterLink, LogoComponent],
  template: `
    <a class="ev-card" [routerLink]="['/events', ev.slug]">
      @if (ev.cover_url || ev.flyer_url) {
        <img [src]="ev.cover_url || ev.flyer_url" alt="" loading="lazy">
      } @else {
        <div class="img-ph" aria-hidden="true"><app-logo [size]="72" color="#4e5452" /></div>
      }
      <div class="body">
        <span class="ev-meta">{{ meta() }}</span>
        <span class="ev-title">{{ ev.title }}</span>
        @if (ev.benefiting) { <span class="ev-sub">Benefiting {{ ev.benefiting }}</span> }
        @else if (ev.summary) { <span class="ev-sub">{{ ev.summary }}</span> }
        @if (ev.is_upcoming && ev.registration_url) { <span class="chip">Registration open</span> }
      </div>
    </a>
  `
})
export class EventCardComponent {
  @Input({ required: true }) ev!: EventItem;
  meta(): string {
    const place = this.ev.venue_name || (this.ev.city ? `${this.ev.city}, TX` : '');
    return [shortDate(this.ev.starts_at), place].filter(Boolean).join(' · ');
  }
}
