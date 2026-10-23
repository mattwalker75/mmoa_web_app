import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { OrgPreview } from '../core/models';
import { S } from '../core/strings';
import { OrgCardComponent } from '../shared/org-card.component';
import { OrgViewComponent } from '../shared/org-view.component';

/**
 * /need-help/preview/:id?preview=<token> — the admin console's Preview of a
 * nonprofit, whatever its status (the console opens it in a framed pop-up;
 * app.js serves this URL frameable only with a valid token). Shows the same
 * two views as the portal's "Preview public profile": the search-result card
 * and the full profile page, with a banner saying whether the org is live.
 */
@Component({
  selector: 'app-org-preview',
  standalone: true,
  imports: [OrgCardComponent, OrgViewComponent],
  template: `
    <div class="page page-narrow">
      @if (state() === 'loading') {
        <div class="loading"><span class="spinner light big" role="status" aria-label="Loading preview"></span></div>
      } @else if (state() === 'missing') {
        <div class="empty" style="margin-top:16px">This preview link has expired or isn't valid. Open the nonprofit in the admin console and click Preview again.</div>
      } @else if (state() === 'error') {
        <div class="empty" role="alert" style="margin-top:16px">{{ S.loadError }}</div>
      } @else if (p(); as p) {
        <div class="preview-banner" role="status">
          <strong>Preview</strong>
          @switch (p.preview_state) {
            @case ('live') { — this nonprofit is live in Need Help. }
            @case ('unverified') { — this nonprofit is <b>not verified yet</b>: not in the directory. }
            @case ('rejected') { — this nonprofit was <b>rejected</b>: not in the directory. }
            @case ('unlisted') { — this nonprofit has <b>hidden its own profile</b> (not listed): not in the directory. }
            @default { — this nonprofit is <b>hidden by MMoA</b>: not in the directory. }
          }
        </div>
        <div class="stack" style="gap:26px">
          <section class="stack" style="gap:12px" aria-labelledby="op-search">
            <h2 id="op-search" class="pp-h">In search results</h2>
            <app-org-card [org]="p.org" [preview]="true" />
          </section>
          <section class="stack" style="gap:12px" aria-labelledby="op-page">
            <h2 id="op-page" class="pp-h">Full profile page</h2>
            <div class="preview-box"><app-org-view [org]="p.org" [preview]="true" /></div>
          </section>
        </div>
      }
    </div>
  `
})
export class OrgPreviewComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  S = S;
  p = signal<OrgPreview | null>(null);
  state = signal<'loading' | 'ok' | 'missing' | 'error'>('loading');
  private seq = 0;

  constructor() {
    this.route.paramMap.subscribe(p => this.load(Number(p.get('id')), this.route.snapshot.queryParamMap.get('preview')));
  }

  private async load(id: number, token: string | null) {
    const mine = ++this.seq;
    this.state.set('loading');
    if (!Number.isInteger(id) || id <= 0 || !token) { this.state.set('missing'); return; }
    try {
      const res = await firstValueFrom(this.api.orgPreview(id, token));
      if (mine !== this.seq) return; // a newer load started
      this.p.set(res);
      this.title.setTitle(`Preview: ${res.org.name} · Need Help? · Mission Men of Anna`);
      this.state.set('ok');
    } catch (err) {
      if (mine === this.seq) this.state.set(err instanceof HttpErrorResponse && err.status === 404 ? 'missing' : 'error');
    }
  }
}
