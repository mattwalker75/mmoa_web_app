import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicOrg } from '../core/models';
import { S } from '../core/strings';

/**
 * One nonprofit as it appears in "Need Help?" search results. Shared by the
 * search page and the portal's "Preview public profile" dialog, so the
 * preview is exactly the card the public sees. `highlight` lists category
 * slugs to mark as matching (the search's selected needs). `preview` turns
 * the profile links into plain text (they would leave the portal).
 */
@Component({
  selector: 'app-org-card',
  standalone: true,
  imports: [RouterLink],
  template: `
    <article class="org-card">
      <div class="title-row">
        @if (preview) { <h3>{{ org.name }}</h3> }
        @else { <h3><a [routerLink]="['/need-help/org', org.org_id]">{{ org.name }}</a></h3> }
        <span class="chip">{{ S.verified }}</span>
      </div>
      @if (org.categories?.length) {
        <div class="tag-row">@for (t of org.categories; track t.slug) { <span class="tag" [class.match]="highlight.includes(t.slug)">{{ t.name }}</span> }</div>
      }
      @if (org.description_html) { <div class="about" [innerHTML]="org.description_html"></div> }
      @if (org.what_to_bring?.length) {
        <div class="inset"><div class="bring-title">{{ S.whatToBring }}</div><div class="soft">{{ org.what_to_bring!.join(' · ') }}</div></div>
      }
      <div class="btn-row" style="gap:10px">
        @if (org.phone) { <a class="btn btn-primary" [href]="'tel:' + tel(org.phone, org.phone_ext)">{{ S.call }} {{ org.phone }}{{ org.phone_ext ? ' ext. ' + org.phone_ext : '' }}</a> }
        @if (org.map_url) { <a class="btn btn-outline" [href]="org.map_url" target="_blank" rel="noopener noreferrer">{{ S.directions }}</a> }
        @if (org.website_url) { <a [href]="org.website_url" target="_blank" rel="noopener noreferrer" style="font-weight:700;padding:10px 6px">{{ S.website }}</a> }
        @if (preview) { <span style="font-weight:700;padding:10px 6px;color:var(--link)">{{ S.fullProfile }}</span> }
        @else { <a [routerLink]="['/need-help/org', org.org_id]" style="font-weight:700;padding:10px 6px">{{ S.fullProfile }}<span class="sr-only">: {{ org.name }}</span></a> }
        @if (where()) { <span class="muted" style="font-size:16px">{{ where() }}</span> }
      </div>
    </article>
  `
})
export class OrgCardComponent {
  @Input({ required: true }) org!: PublicOrg;
  @Input() highlight: string[] = [];
  @Input() preview = false;
  S = S;

  /** tel: target; a "," pause before the extension makes phones dial it after connecting. */
  tel(p: string, ext?: string | null) { const d = p.replace(/\D/g, ''); return (d.length === 10 ? '+1' + d : d) + (ext ? ',' + ext : ''); }
  where() { return [this.org.address?.city || this.org.service_cities?.[0] || '', this.org.hours || ''].filter(Boolean).join(' · '); }
}
