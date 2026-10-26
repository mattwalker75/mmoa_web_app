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

  readonly phone = computed(() => this.info().phone);
  /** tel: target — digits only, +1 for a 10-digit US number. */
  readonly phoneTel = computed(() => {
    const d = (this.info().phone || '').replace(/\D/g, '');
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
    const html = this.info().sections[key];
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : null;
  }
}
