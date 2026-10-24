import { Component, Input, inject } from '@angular/core';
import { PublicOrg } from '../core/models';
import { S } from '../core/strings';
import { Kind, MetricsService } from '../core/metrics.service';

/**
 * The body of a nonprofit's public profile — used by /need-help/org/:id and
 * by the portal's "Preview public profile", so the preview is exactly what
 * the public sees. Renders only the fields present (hidden ones are absent
 * from the API response). description_html comes from the server's
 * markdown-lite renderer, which escapes everything first.
 */
@Component({
  selector: 'app-org-view',
  standalone: true,
  template: `
    <div class="stack">
      <div>
        <div class="title-row">
          @if (preview) { <h3 style="margin:0;font-size:34px;text-transform:uppercase">{{ org.name }}</h3> }
          @else { <h1 style="margin:0">{{ org.name }}</h1> }
          <span class="chip">{{ S.verified }}</span>
        </div>
        @if (org.categories?.length) {
          <div class="tag-row" style="margin-top:12px" [attr.aria-label]="S.services">
            @for (c of org.categories; track c.slug) { <span class="tag">{{ c.name }}</span> }
          </div>
        }
      </div>

      <div class="btn-row">
        @if (org.phone) { <a class="btn btn-primary" [href]="'tel:' + tel(org.phone, org.phone_ext)" (click)="hit('call')">{{ S.call }} {{ org.phone }}{{ org.phone_ext ? ' ext. ' + org.phone_ext : '' }}</a> }
        @if (org.map_url) { <a class="btn btn-outline" [href]="org.map_url" target="_blank" rel="noopener noreferrer" (click)="hit('directions')">{{ S.directions }}</a> }
        @if (org.website_url) { <a class="btn btn-ghost" [href]="org.website_url" target="_blank" rel="noopener noreferrer" (click)="hit('website')">{{ S.website }}</a> }
      </div>

      @if (org.description_html) {
        <section><h2 class="plain-h2">{{ S.about }}</h2><div class="prose" [innerHTML]="org.description_html"></div></section>
      }
      @if (org.what_to_bring?.length) {
        <section class="inset"><div class="bring-title">{{ S.whatToBring }}</div>
          <ul style="margin:0;padding-left:20px">@for (b of org.what_to_bring; track $index) { <li>{{ b }}</li> }</ul>
        </section>
      }

      <section class="card">
        <h2 class="plain-h2">{{ S.contact }}</h2>
        <dl class="kv">
          @if (org.address) { <dt>{{ S.address }}</dt><dd>{{ org.address.text }}</dd> }
          @if (org.hours) { <dt>{{ S.hours }}</dt><dd style="white-space:pre-line">{{ org.hours }}</dd> }
          @if (org.phone) { <dt>{{ S.phone }}</dt><dd><a [href]="'tel:' + tel(org.phone, org.phone_ext)" (click)="hit('call')">{{ org.phone }}{{ org.phone_ext ? ' ext. ' + org.phone_ext : '' }}</a></dd> }
          @if (org.public_email) { <dt>{{ S.email }}</dt><dd><a [href]="'mailto:' + org.public_email" (click)="hit('email')">{{ org.public_email }}</a></dd> }
          @if (org.website_url) { <dt>{{ S.website }}</dt><dd><a [href]="org.website_url" target="_blank" rel="noopener noreferrer" (click)="hit('website')">{{ host(org.website_url) }}</a></dd> }
          @if (org.facebook_url) { <dt>{{ S.facebook }}</dt><dd><a [href]="org.facebook_url" target="_blank" rel="noopener noreferrer" (click)="hit('facebook')">{{ host(org.facebook_url) }}</a></dd> }
          @if (org.instagram_url) { <dt>{{ S.instagram }}</dt><dd><a [href]="org.instagram_url" target="_blank" rel="noopener noreferrer" (click)="hit('instagram')">{{ host(org.instagram_url) }}</a></dd> }
          @if (org.other_social_url) { <dt>{{ S.otherLink }}</dt><dd><a [href]="org.other_social_url" target="_blank" rel="noopener noreferrer" (click)="hit('other_link')">{{ host(org.other_social_url) }}</a></dd> }
          @if (org.service_cities?.length) { <dt>{{ S.citiesServed }}</dt><dd>{{ org.service_cities!.join(', ') }}</dd> }
        </dl>
      </section>

      @if (org.contacts?.length) {
        <section>
          <h2 class="plain-h2">{{ S.people }}</h2>
          <div class="ben-grid">
            @for (c of org.contacts; track $index) {
              <div class="ben">
                {{ c.name }}
                @if (c.role) { <div class="s">{{ c.role }}</div> }
                @if (c.phone) { <div class="s"><a [href]="'tel:' + tel(c.phone, c.phone_ext)" (click)="hit('call')">{{ c.phone }}{{ c.phone_ext ? ' ext. ' + c.phone_ext : '' }}</a></div> }
                @if (c.email) { <div class="s"><a [href]="'mailto:' + c.email" (click)="hit('email')">{{ c.email }}</a></div> }
              </div>
            }
          </div>
        </section>
      }

      @if (org.images?.length) {
        <section>
          <h2 class="plain-h2">{{ S.photos }}</h2>
          <div class="profile-photos">
            @for (i of org.images; track i.url) {
              <figure class="photo">
                <img [src]="i.url" [alt]="i.alt || ''" loading="lazy">
                @if (i.alt) { <figcaption aria-hidden="true">{{ i.alt }}</figcaption> }
              </figure>
            }
          </div>
        </section>
      }
    </div>
  `
})
export class OrgViewComponent {
  @Input({ required: true }) org!: PublicOrg;
  /** Inside the portal / console preview: no page-level <h1> (the portal has its own) and no activity tracking. */
  @Input() preview = false;
  private metrics = inject(MetricsService);
  S = S;

  /** Count a link click for the org's activity card — not from a preview. */
  hit(kind: Kind) { if (!this.preview) this.metrics.track(this.org.org_id, kind); }
  /** tel: target; a "," pause before the extension makes phones dial it after connecting. */
  tel(p: string, ext?: string | null) { const d = p.replace(/\D/g, ''); return (d.length === 10 ? '+1' + d : d) + (ext ? ',' + ext : ''); }
  host(u: string) { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/$/, ''); } catch { return u; } }
}
