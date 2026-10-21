import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Category, City, PublicOrg } from '../core/models';
import { S } from '../core/strings';
import { OrgCardComponent } from '../shared/org-card.component';

/**
 * /need-help (NeedHelp mockup): pick a need (category tiles), a city and an
 * optional keyword; results are verified + listed nonprofits only. Several
 * needs can be picked at once (an org matching ANY of them shows, those
 * covering more rank first); "Clear all" empties the selection, which means
 * "show everything". The keyword filters as you type (debounced; Enter runs
 * it at once) and "Clear search" empties it. The choices live in the URL
 * (?category=a,b&city=&q=) so Back works and a search can be shared —
 * nothing is stored anywhere. Typing replaces the history entry instead of
 * adding one per keystroke.
 */
@Component({
  selector: 'app-need-help',
  standalone: true,
  imports: [FormsModule, OrgCardComponent],
  template: `
    <div class="page stack" style="gap:30px">
      <div>
        <span class="kicker">{{ S.kicker }}</span>
        <h1 style="margin:8px 0 10px">{{ S.title }}</h1>
        <p class="lede" style="margin:0">{{ S.intro }}</p>
      </div>

      <section aria-labelledby="need-label" class="stack" style="gap:12px">
        <div class="need-head">
          <div>
            <h2 id="need-label" style="font-size:24px;font-weight:700;margin:0;letter-spacing:.03em">{{ S.stepNeed }}</h2>
            <p class="muted" style="margin:4px 0 0;font-size:16px">{{ S.pickHint }}</p>
          </div>
          <div class="need-actions">
            @if (selected().length) { <span class="muted" style="font-size:16px">{{ S.selectedCount(selected().length) }}</span> }
            <button type="button" class="btn btn-outline" [disabled]="!selected().length" (click)="clearAll()">{{ S.clearAll }}</button>
          </div>
        </div>
        <div class="cat-grid" role="group" aria-labelledby="need-label">
          @for (c of categories(); track c.slug) {
            <button type="button" class="cat-tile" [attr.aria-pressed]="isOn(c.slug)" (click)="toggle(c.slug)">{{ c.name }}</button>
          }
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
          <input id="nh-kw" class="input" type="search" name="q" maxlength="200" autocomplete="off" [placeholder]="S.keywordPlaceholder"
                 [ngModel]="q" (ngModelChange)="onType($event)">
        </div>
        <button type="button" class="btn btn-outline" [disabled]="!q.trim()" (click)="clearKeyword()">{{ S.clearSearch }}</button>
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
            <app-org-card [org]="r" [highlight]="selected()" />
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
  selected = signal<string[]>([]);
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
      this.selected.set((p.get('category') || '').split(',').map(s => s.trim()).filter(Boolean));
      this.city.set(p.get('city') || 'any');
      // Only adopt the URL's keyword when it really differs (Back/Forward or a
      // shared link) — never overwrite what's mid-typing, e.g. a trailing space.
      const urlQ = p.get('q') || '';
      if (urlQ !== this.q.trim()) this.q = urlQ;
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

  isOn(slug: string) { return this.selected().includes(slug); }
  toggle(slug: string) {
    // Keep the selection in the categories' display order (stable URLs).
    const on = new Set(this.selected());
    on.has(slug) ? on.delete(slug) : on.add(slug);
    this.selected.set(this.categories().map(c => c.slug).filter(s => on.has(s)));
    this.submit();
  }
  clearAll() { this.selected.set([]); this.submit(); }

  private typing?: ReturnType<typeof setTimeout>;
  /** Filter as you type: wait for a short pause so each keystroke isn't a request. */
  onType(v: string) {
    this.q = v;
    clearTimeout(this.typing);
    this.typing = setTimeout(() => this.submit(true), 300);
  }
  clearKeyword() {
    clearTimeout(this.typing);
    this.q = '';
    this.submit();
    document.getElementById('nh-kw')?.focus();
  }

  /** Put the choices in the URL; the queryParamMap subscription runs the search.
   *  `typing` replaces the current history entry (one entry per search, not
   *  per keystroke). */
  submit(typing = false) {
    if (!typing) clearTimeout(this.typing);
    const queryParams: Record<string, string | null> = {
      category: this.selected().length ? this.selected().join(',') : null,
      city: this.city() && this.city() !== 'any' ? this.city() : null,
      q: this.q.trim() || null
    };
    this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: typing });
  }

  private async search() {
    const mine = ++this.seq;
    this.loading.set(true);
    this.error.set(false);
    try {
      const res = await firstValueFrom(this.api.directorySearch({ categories: this.selected(), city: this.city(), q: this.q.trim() }));
      if (mine !== this.seq) return; // a newer search started
      this.results.set(res.results);
      this.summary.set(S.resultsSummary(res.count, (res.categories || []).map(c => c.name), res.city !== 'any' ? res.city : null));
    } catch {
      if (mine === this.seq) { this.results.set([]); this.error.set(true); }
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

}
