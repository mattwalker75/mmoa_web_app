import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { NavComponent } from './layout/nav.component';
import { AuthService } from './core/auth.service';
import { ApiService } from './core/api.service';
import { WindowConfig } from './core/models';
import { windowStyle } from './core/window-style';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavComponent],
  template: `
    @if (booted()) {
      <app-nav />
      <main><router-outlet /></main>
      <footer>
        <div class="panel foot-panel" [style]="style('footer')">
          @if (win('footer')?.showTag && win('footer')?.tag) { <span class="panel-tag">{{ win('footer')?.tag }}</span> }
          <div [innerHTML]="footer()"></div>
        </div>
      </footer>
    } @else {
      <div class="boot"><div class="spinner dark"></div></div>
    }
  `,
  styles: [`
    main { min-height: calc(100vh - 70px); }
    .boot { min-height: 100vh; display: grid; place-items: center; }
    .spinner.dark { border-color: rgba(19,41,75,.2); border-top-color: var(--brand-700); width: 30px; height: 30px; }
  `]
})
export class App {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);
  booted = this.auth.ready; // set by bootstrap(), which runs as an app initializer
  private footerHtml = signal<string>('');
  private windows = signal<Record<string, WindowConfig>>({});

  constructor() {
    this.loadFooter();
  }

  /** Admin-authored footer HTML (HTML/footer.html, served via /api/content).
   *  Trusted: first-party content written by the admin console, never user input. */
  footer(): SafeHtml {
    const html = this.footerHtml();
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : '';
  }

  /** Resolved window chrome for a section (undefined until /api/content loads). */
  win(key: string): WindowConfig | undefined {
    return this.windows()[key];
  }

  style(key: string): Record<string, string> { return windowStyle(this.win(key)); }

  private async loadFooter() {
    try {
      const res = await firstValueFrom(this.api.content());
      this.footerHtml.set((res.sections && res.sections['footer']) || '');
      this.windows.set(res.windows || {});
    } catch { /* footer renders empty if content API is unavailable */ }
  }
}
