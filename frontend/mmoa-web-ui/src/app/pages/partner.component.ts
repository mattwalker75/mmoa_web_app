import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { SiteService } from '../core/site.service';
import { RouteLinksDirective } from '../shared/route-links.directive';

/** /partner — Partner With Us copy (HTML/partner.html) + nonprofit sign-up CTA. */
@Component({
  selector: 'app-partner',
  standalone: true,
  imports: [RouterLink, RouteLinksDirective],
  template: `
    <div class="page page-narrow stack">
      <div>
        <span class="kicker">For local nonprofits</span>
        <h1>Partner with us</h1>
      </div>
      <div class="cms prose" appRouteLinks [innerHTML]="site.section('partner') || ''"></div>
      <section class="card" aria-labelledby="cta-h" style="border-color:var(--band-line);background:var(--band-bg)">
        @if (auth.isLoggedIn()) {
          <h2 id="cta-h" style="font-size:28px">You're signed in</h2>
          <p class="soft">Keep your organization's profile up to date so people can find you.</p>
          <a class="btn btn-primary btn-lg" routerLink="/portal">Edit my profile</a>
        } @else {
          <h2 id="cta-h" style="font-size:28px">Create your free nonprofit login</h2>
          <p class="soft">You'll need your organization's EIN. It takes about five minutes.</p>
          <div class="btn-row">
            @if (open()) { <a class="btn btn-primary btn-lg" routerLink="/signup">Get started</a> }
            @else { <span class="muted">New sign-ups are paused right now — please call us.</span> }
            <a class="btn btn-outline btn-lg" routerLink="/login">I already have a login</a>
          </div>
        }
      </section>
    </div>
  `
})
export class PartnerComponent {
  auth = inject(AuthService);
  site = inject(SiteService);
  open() { return this.auth.config()?.allowMemberRegistration !== false; }
}
