import { Component, Input, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteService } from '../core/site.service';
import { RouteLinksDirective } from '../shared/route-links.directive';
import { S } from '../core/strings';

/**
 * Site footer (every page). The org info + links come from the admin-editable
 * HTML/footer.html; the "Need help now?" emergency box is built in here so it
 * can never be edited away by accident.
 */
@Component({
  selector: 'app-site-footer',
  standalone: true,
  imports: [RouterLink, RouteLinksDirective],
  template: `
    <footer class="site-footer">
      @if (needHelp) {
        <div class="foot-note"><div class="bar">
          <span>{{ S.listingNote }}</span>
          <a routerLink="/partner">{{ S.getListed }}</a>
        </div></div>
      }
      <div class="bar">
        @if (site.section('footer'); as html) {
          <div class="foot-content" appRouteLinks [innerHTML]="html"></div>
        } @else {
          <div class="foot-content">
            <div class="foot-org">
              <div class="foot-brand">Mission Men of Anna</div>
              <div>A 501(c)(3) nonprofit@if (site.info().ein) { · EIN {{ site.info().ein }}}</div>
              <div>Anna, Texas@if (site.phone()) { · <a [href]="'tel:' + site.phoneTel()">{{ site.phone() }}</a>}</div>
            </div>
            <nav class="foot-links" aria-label="Footer">
              @if (site.facebook(); as fb) { <a [href]="fb" target="_blank" rel="noopener">Facebook</a> }
              @if (site.info().donationUrl; as url) { <a [href]="url" target="_blank" rel="noopener">Donate</a> }
              <a routerLink="/partner">Partner with us</a>
              <a routerLink="/login">Nonprofit login</a>
            </nav>
          </div>
        }
        <aside class="help-now" aria-label="Need help now?">
          <strong>Need help now?</strong><br>
          Emergency: <a href="tel:911">911</a> · Crisis line: <a href="tel:988">988</a><br>
          Other local services: dial <a href="tel:211">211</a>
        </aside>
      </div>
    </footer>
  `
})
export class SiteFooterComponent {
  site = inject(SiteService);
  S = S;
  /** On "Need Help?" pages: adds the listing-source note above the footer. */
  @Input() needHelp = false;
}
