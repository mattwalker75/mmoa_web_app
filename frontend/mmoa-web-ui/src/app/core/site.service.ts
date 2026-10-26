import { Injectable, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { SiteInfo } from './models';

/** Fallbacks used until /api/site answers (or if it can't). */
const DEFAULTS: SiteInfo = {
  appTitle: 'Mission Men of Anna',
  orgName: 'Mission Men of Anna Inc',
  phone: '',
  ein: '33-4035685',
  facebookUrl: 'https://www.facebook.com/missionmenofanna',
  donationUrl: '',
  logoUrl: null,
  sections: {}
};

/**
 * Org facts (phone, EIN, Facebook) and the admin-editable website sections
 * from GET /api/site, loaded once at start-up and shared by every page.
 */
@Injectable({ providedIn: 'root' })
export class SiteService {
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);
  readonly info = signal<SiteInfo>(DEFAULTS);
  readonly loaded = signal(false);

  /** The public phone, or '' unless it's a real number (7–15 digits) — every
   *  "Call" button / phone line on the site shows only when this is set. */
  readonly phone = computed(() => {
    const p = (this.info().phone || '').trim();
    const n = p.replace(/\D/g, '').length;
    return n >= 7 && n <= 15 ? p : '';
  });
  /** The public email, or '' unless it looks like a real address. */
  readonly email = computed(() => {
    const e = (this.info().email || '').trim();
    return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e) ? e : '';
  });
  /** The header "Need Help?" button + other links to the directory (on unless turned off). */
  readonly needHelp = computed(() => this.info().needHelpEnabled !== false);
  /** The Facebook page, or '' when none is set (every Facebook link hides). */
  readonly facebook = computed(() => (this.info().facebookUrl || '').trim());
  /** tel: target — digits only, +1 for a 10-digit US number. */
  readonly phoneTel = computed(() => {
    const d = this.phone().replace(/\D/g, '');
    return d.length === 10 ? '+1' + d : d;
  });

  async load(): Promise<void> {
    try {
      const s = await firstValueFrom(this.api.site());
      this.info.set({ ...DEFAULTS, ...s, sections: s.sections || {} });
    } catch { /* keep the defaults; sections render empty */ }
    this.loaded.set(true);
  }

  /** A website section (HTML/<key>.html) as trusted HTML. Trusted because it
   *  is first-party content written only by the admin console, never user
   *  input — and the CSP still blocks any script in it. */
  /** 'content' — the section has something to show; 'empty' — the admin
   *  blanked it (hide it); 'missing' — no such file (use a built-in default). */
  sectionState(key: string): 'content' | 'empty' | 'missing' {
    const html = this.info().sections[key];
    if (typeof html !== 'string') return 'missing';
    return html.replace(/<!--[\s\S]*?-->/g, '').trim() ? 'content' : 'empty';
  }

  section(key: string): SafeHtml | null {
    return this.trustedSections()[key] || null;
  }
  /** Built once per site load, so [innerHTML] sees the same object on every
   *  change detection and never re-renders (which would drop focus and text
   *  selection inside a section). */
  private readonly trustedSections = computed(() => {
    const out: Record<string, SafeHtml> = {};
    for (const [k, html] of Object.entries(this.info().sections || {})) {
      if (html) out[k] = this.sanitizer.bypassSecurityTrustHtml(html);
    }
    return out;
  });
}
