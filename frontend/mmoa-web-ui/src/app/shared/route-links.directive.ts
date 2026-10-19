import { Directive, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Put on a container that renders admin-authored HTML via [innerHTML]
 * (website sections). Plain same-site links inside it (href="/events") then
 * navigate in-app through the router instead of reloading the whole SPA.
 * New-tab clicks, external links, downloads and file paths are left alone.
 */
@Directive({
  selector: '[appRouteLinks]',
  standalone: true,
  host: { '(click)': 'onClick($event)' }
})
export class RouteLinksDirective {
  private router = inject(Router);

  onClick(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a) return;
    if ((a.getAttribute('target') && a.getAttribute('target') !== '_self') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('/') || href.startsWith('//')) return;
    if (/^\/(api|content|uploads)\//.test(href)) return;
    e.preventDefault();
    this.router.navigateByUrl(href);
  }
}
