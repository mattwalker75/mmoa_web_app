import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { MetricsService } from '../core/metrics.service';
import { PublicOrg } from '../core/models';
import { S } from '../core/strings';
import { OrgViewComponent } from '../shared/org-view.component';

/** /need-help/org/:id — a verified nonprofit's public profile (public fields only). */
@Component({
  selector: 'app-org-profile',
  standalone: true,
  imports: [RouterLink, OrgViewComponent],
  template: `
    <div class="page page-narrow">
      <a class="back-link" routerLink="/need-help">{{ S.backToSearch }}</a>
      @if (state() === 'loading') {
        <div class="loading"><span class="spinner light big" role="status" aria-label="Loading"></span></div>
      } @else if (state() === 'missing') {
        <div class="empty" style="margin-top:16px">{{ S.notFound }}</div>
      } @else if (state() === 'error') {
        <div class="empty" role="alert" style="margin-top:16px">{{ S.loadError }}</div>
      } @else if (org(); as o) {
        <div style="margin-top:16px"><app-org-view [org]="o" /></div>
      }
    </div>
  `
})
export class OrgProfileComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  private metrics = inject(MetricsService);
  S = S;
  org = signal<PublicOrg | null>(null);
  state = signal<'loading' | 'ok' | 'missing' | 'error'>('loading');
  private seq = 0;

  constructor() {
    this.route.paramMap.subscribe(p => this.load(Number(p.get('id'))));
  }

  private async load(id: number) {
    const mine = ++this.seq;
    this.state.set('loading');
    if (!Number.isInteger(id) || id <= 0) { this.state.set('missing'); return; }
    try {
      const res = await firstValueFrom(this.api.directoryOrg(id));
      if (mine !== this.seq) return; // a newer load started
      this.org.set(res.org);
      this.title.setTitle(`${res.org.name} · Need Help? · Mission Men of Anna`);
      this.state.set('ok');
      // One 'view' per load of the real public page. The console preview
      // (/need-help/preview/:id, OrgPreviewComponent) never comes here, and a
      // preview-flagged payload is not counted either.
      if (!(res as { preview?: boolean }).preview) this.metrics.track(res.org.org_id, 'view');
    } catch (err) {
      if (mine === this.seq) this.state.set(err instanceof HttpErrorResponse && err.status === 404 ? 'missing' : 'error');
    }
  }
}
