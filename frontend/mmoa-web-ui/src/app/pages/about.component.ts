import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { SiteService } from '../core/site.service';
import { BoardMember } from '../core/models';
import { CORE_VALUES, PAST_IMPACT, PHOTOS } from '../core/site-content';
import { RouteLinksDirective } from '../shared/route-links.directive';
import { LogoComponent } from '../shared/logo.component';

/** /about — story, values, board, impact, photos, how you can help. */
@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RouterLink, RouteLinksDirective, LogoComponent],
  template: `
    <div class="page stack" style="gap:48px">
      <section class="story">
        <div>
          <span class="kicker">About us · Est 2024</span>
          <h1>Our story</h1>
          <div class="prose" appRouteLinks [innerHTML]="site.section('about') || ''"></div>
        </div>
        <img [src]="photos.group.src" [alt]="photos.group.alt" style="width:100%;border-radius:18px;object-fit:cover;max-height:420px">
      </section>

      <section aria-labelledby="values-h">
        <h2 id="values-h">Our core values</h2>
        <div class="values">
          @for (v of values; track v.name) { <div class="card"><h3>{{ v.name }}</h3><p>{{ v.text }}</p></div> }
        </div>
      </section>

      <section aria-labelledby="board-h">
        <h2 id="board-h">Board of directors</h2>
        @if (board().length) {
          <div class="board">
            @for (b of board(); track b.board_id) {
              <div class="card">
                @if (b.photo_url) { <img [src]="b.photo_url" [alt]="b.person_name ? 'Photo of ' + b.person_name : ''" loading="lazy"> }
                @else { <div class="ph" aria-hidden="true"><app-logo [size]="64" color="#4e5452" /></div> }
                <div class="role">{{ b.role_title }}</div>
                <div class="name">{{ b.person_name || 'Position open' }}</div>
                @if (b.role_description) { <div class="muted small">{{ b.role_description }}</div> }
              </div>
            }
          </div>
        } @else if (boardError()) {
          <p class="muted">The board list is unavailable right now.</p>
        }
      </section>

      <!-- HTML/impact.html (editable in the admin console); the built-in list
           only if that file is missing, nothing if it was emptied. -->
      @if (site.loaded() && site.sectionState('impact') !== 'empty') {
        <section aria-labelledby="impact-h">
          <h2 id="impact-h">What we've done</h2>
          @if (site.sectionState('impact') === 'content') {
            <div appRouteLinks [innerHTML]="site.section('impact')"></div>
          } @else {
            <ul class="impact">@for (i of impact; track i) { <li>{{ i }}</li> }</ul>
          }
        </section>
      }

      <section aria-label="Photos">
        <div class="gallery">@for (p of gallery; track p.src) { <img [src]="p.src" [alt]="p.alt" loading="lazy"> }</div>
      </section>

      <section aria-labelledby="help-h" class="cms">
        <h2 id="help-h">How you can help</h2>
        <div appRouteLinks [innerHTML]="site.section('help') || ''"></div>
        <div class="btn-row">
          <a class="btn btn-primary btn-lg" routerLink="/partner">Partner with us</a>
          @if (site.phone()) { <a class="btn btn-outline btn-lg" [href]="'tel:' + site.phoneTel()">Call {{ site.phone() }}</a> }
          @if (site.email()) { <a class="btn btn-outline btn-lg" [href]="'mailto:' + site.email()">Email us</a> }
          <a class="btn btn-outline btn-lg" [href]="site.info().facebookUrl" target="_blank" rel="noopener">Follow us on Facebook</a>
        </div>
      </section>
    </div>
  `
})
export class AboutComponent {
  private api = inject(ApiService);
  site = inject(SiteService);
  board = signal<BoardMember[]>([]);
  boardError = signal(false);
  values = CORE_VALUES;
  impact = PAST_IMPACT;
  photos = PHOTOS;
  gallery = [PHOTOS.angeltree, PHOTOS.booth, PHOTOS.fundraiser, PHOTOS.volunteers, PHOTOS.legion, PHOTOS.carshow];

  constructor() {
    firstValueFrom(this.api.board()).then(r => this.board.set(r.board)).catch(() => this.boardError.set(true));
  }
}
