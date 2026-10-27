import { Component, Input, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicOrg } from '../core/models';

/**
 * Home-page strip of verified, listed nonprofits that drifts left → right in
 * a continuous loop (a CSS marquee: the list is rendered twice and the track
 * slides by half its width, so the seam is invisible).
 *
 * Moving content must be stoppable (WCAG 2.2.2), so it pauses on hover and
 * while a card has keyboard focus, and has a Pause/Play button. Visitors who
 * ask for reduced motion get a still, swipe/scroll-able row instead. The
 * second copy exists only for the visual loop: it's hidden from screen
 * readers and its links are out of the tab order. With fewer than 4
 * nonprofits there's nothing to loop, so the row just sits still.
 * Phones (≤ 700px) always get the still, swipeable row with a
 * "Swipe for more" hint: a moving strip is hard to read and tap on a small
 * screen (styles.scss "Phones").
 */
@Component({
  selector: 'app-nonprofit-carousel',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="np-carousel" [class.paused]="paused()" [class.static]="!animate()">
      @if (animate()) {
        <button type="button" class="btn btn-outline btn-sm np-toggle" (click)="paused.set(!paused())"
                [attr.aria-label]="paused() ? 'Play the nonprofit slideshow' : 'Pause the nonprofit slideshow'">{{ paused() ? '▶ Play' : '❚❚ Pause' }}</button>
      }
      <div class="np-viewport">
        <div class="np-track" [style.animation-duration.s]="duration()">
          @for (copy of copies(); track copy) {
            <ul class="np-list" [attr.aria-hidden]="copy === 1 ? 'true' : null">
              @for (o of orgs; track o.org_id) {
                <li>
                  <a class="np-card" [routerLink]="['/need-help/org', o.org_id]" [attr.tabindex]="copy === 1 ? -1 : null">
                    @if (o.images?.length) { <img [src]="o.images![0].url" [alt]="''" loading="lazy"> }
                    @else { <div class="np-initials" aria-hidden="true">{{ initials(o.name) }}</div> }
                    <div class="np-body">
                      <div class="np-name">{{ o.name }}</div>
                      @if (o.categories?.length) {
                        <div class="np-tags">@for (c of o.categories!.slice(0, 3); track c.slug) { <span class="tag">{{ c.name }}</span> }</div>
                      }
                      @if (where(o)) { <div class="np-where">{{ where(o) }}</div> }
                    </div>
                  </a>
                </li>
              }
            </ul>
          }
        </div>
      </div>
      @if (orgs.length > 1) { <p class="np-swipe-hint phone-only" aria-hidden="true">Swipe for more →</p> }
    </div>
  `
})
export class NonprofitCarouselComponent {
  private _orgs: PublicOrg[] = [];
  private count = signal(0);
  @Input({ required: true }) set orgs(v: PublicOrg[]) { this._orgs = v || []; this.count.set(this._orgs.length); }
  get orgs() { return this._orgs; }

  paused = signal(false);
  animate = computed(() => this.count() >= 4);
  copies = computed(() => this.animate() ? [0, 1] : [0]);
  /** ~6 seconds per card on screen keeps it readable at any list size. */
  duration = computed(() => Math.max(30, this.count() * 6));

  initials(name: string) { return name.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
  where(o: PublicOrg) { return o.address?.city || o.service_cities?.[0] || ''; }
}
