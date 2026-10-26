import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteService } from '../core/site.service';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page page-narrow">
      <h1>Page not found</h1>
      <p class="lede">That page doesn't exist. Try the <a routerLink="/">home page</a>@if (site.needHelp()) {, our <a routerLink="/events">events</a>,
        or <a routerLink="/need-help">find help near Anna</a>} @else { or our <a routerLink="/events">events</a>}.</p>
    </div>
  `
})
export class NotFoundComponent {
  site = inject(SiteService);
}
