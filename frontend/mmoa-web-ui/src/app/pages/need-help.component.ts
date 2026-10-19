import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Category, City, PublicOrg } from '../core/models';
import { S } from '../core/strings';

/**
 * /need-help (NeedHelp mockup): pick a need (category tiles), a city and an
 * optional keyword; results are verified + listed nonprofits only. The
 * choices live in the URL (?category=&city=&q=) so Back works and a search
 * can be shared — nothing is stored anywhere.
 */
@Component({
  selector: 'app-need-help',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page stack" style="gap:30px">
      <div>
        <span class="kicker">{{ S.kicker }}</span>
        <h1 style="margin:8px 0 10px">{{ S.title }}</h1>
        <p class="lede" style="margin:0">{{ S.intro }}</p>
      </div>

      <section aria-labelledby="need-label" class="stack" style="gap:12px">
        <h2 id="need-label" style="font-size:24px;font-weight:700;margin:0;letter-spacing:.03em">{{ S.stepNeed }}</h2>
        <div class="cat-grid">
          @for (c of categories(); track c.slug) {
            <button type="button" class="cat-tile" [attr.aria-pressed]="category() === c.slug" (click)="pick(c.slug)">{{ c.name }}</button>
          }
          <button type="button" class="cat-tile" [attr.aria-pressed]="category() === ''" (click)="pick('')">{{ S.allNeeds }}</button>
        </div>
      </section>

      <form class="refine" aria-label="Refine search" (ngSubmit)="submit()">
        <div class="field city">
          <label for="nh-city">{{ S.stepCity }}</label>
          <select id="nh-city" class="select" name="city" [ngModel]="city()" (ngModelChange)="city.set($event); submit()">
            <option value="any">{{ S.anyCity }}</option>
            @for (c of cities(); track c.city_id) { <option [value]="c.name">{{ c.name }}</option> }
          </select>
        </div>
        <div class="field kw">
          <label for="nh-kw">{{ S.keyword }}</label>
          <input id="nh-kw" class="input" type="search" name="q" maxlength="200" [placeholder]="S.keywordPlaceholder" [(ngModel)]="q">
        </div>
        <button type="submit" class="btn btn-primary">{{ S.search }}</button>
      </form>

      <section aria-live="polite" [attr.aria-busy]="loading()" class="stack" style="gap:16px">
        @if (error()) {
          <div class="empty" role="alert">{{ S.loadError }}</div>
        } @else if (loading() && !results().length) {
          <p class="muted">{{ S.searching }}</p>
        } @else {
          <div class="result-head"><h2>{{ summary() }}</h2></div>
          @if (!results().length) {
            <div class="empty">{{ S.noResults }}</div>
          }
          @for (r of results(); track r.org_id) {
            <article class="org-card">
              <div class="title-row">
                <h3><a [routerLink]="['/need-help/org', r.org_id]">{{ r.name }}</a></h3>
                <span class="chip">{{ S.verified }}</span>
              </div>
              @if (r.categories?.length) {
                <div class="tag-row">@for (t of r.categories; track t.slug) { <span class="tag">{{ t.name }}</span> }</div>
              }
              @if (r.description_html) { <div class="about" [innerHTML]="r.description_html"></div> }
              @if (r.what_to_bring?.length) {
                <div class="inset"><div class="bring-title">{{ S.whatToBring }}</div><div class="soft">{{ r.what_to_bring!.join(' · ') }}</div></div>
              }
              <div class="btn-row" style="gap:10px">
                @if (r.phone) { <a class="btn btn-primary" [href]="'tel:' + tel(r.phone)">{{ S.call }} {{ r.phone }}</a> }
                @if (r.map_url) { <a class="btn btn-outline" [href]="r.map_url" target="_blank" rel="noopener noreferrer">{{ S.directions }}</a> }
                @if (r.website_url) { <a [href]="r.website_url" target="_blank" rel="noopener noreferrer" style="font-weight:700;padding:10px 6px">{{ S.website }}</a> }
                <a [routerLink]="['/need-help/org', r.org_id]" style="font-weight:700;padding:10px 6px">{{ S.fullProfile }}<span class="sr-only">: {{ r.name }}</span></a>
                @if (where(r)) { <span class="muted" style="font-size:16px">{{ where(r) }}</span> }
              </div>
            </article>
          }
        }
      </section>
    </div>
  `
})
export class NeedHelpComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  S = S;

  categories = signal<Category[]>([]);
  cities = signal<City[]>([]);
  category = signal('');
  city = signal('any');
  q = '';
  results = signal<PublicOrg[]>([]);
  summary = signal('');
  loading = signal(true);
  error = signal(false);
  private seq = 0;

  constructor() {
    this.loadMeta();
    this.route.queryParamMap.subscribe(p => {
      this.category.set(p.get('category') || '');
      this.city.set(p.get('city') || 'any');
      this.q = p.get('q') || '';
      this.search();
    });
  }

  private async loadMeta() {
    try {
      const m = await firstValueFrom(this.api.directoryMeta());
      this.categories.set(m.categories);
      this.cities.set(m.cities);
    } catch { this.error.set(true); }
  }

  pick(slug: string) { this.category.set(slug); this.submit(); }

  /** Put the choices in the URL; the queryParamMap subscription runs the search. */
  submit() {
    const queryParams: Record<string, string | null> = {
      category: this.category() || null,
      city: this.city() && this.city() !== 'any' ? this.city() : null,
      q: this.q.trim() || null
    };
    this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: false });
  }

  private async search() {
    const mine = ++this.seq;
    this.loading.set(true);
    this.error.set(false);
    try {
      const res = await firstValueFrom(this.api.directorySearch({ category: this.category(), city: this.city(), q: this.q.trim() }));
      if (mine !== this.seq) return; // a newer search started
      this.results.set(res.results);
      this.summary.set(S.resultsSummary(res.count, res.category?.name || null, res.city !== 'any' ? res.city : null));
    } catch {
      if (mine === this.seq) { this.results.set([]); this.error.set(true); }
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

  tel(p: string) { const d = p.replace(/\D/g, ''); return d.length === 10 ? '+1' + d : d; }
  where(r: PublicOrg) { return [r.address?.city || r.service_cities?.[0] || '', r.hours || ''].filter(Boolean).join(' · '); }
}
