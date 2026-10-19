import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { PublicConfig, User } from './models';

/**
 * Holds the current session user and the public app config as signals so the
 * nav and guards react without manual subscriptions. `bootstrap()` runs once
 * at app start to hydrate both.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);

  readonly user = signal<User | null>(null);
  readonly config = signal<PublicConfig | null>(null);
  readonly ready = signal(false);

  readonly isLoggedIn = computed(() => this.user() !== null);

  /** Display name for the site — config.appTitle, with a sane fallback. */
  readonly appTitle = computed(() => this.config()?.appTitle || 'Mission Men of Anna');

  async bootstrap(): Promise<void> {
    const [cfg, me] = await Promise.allSettled([
      firstValueFrom(this.api.config()),
      firstValueFrom(this.api.me())
    ]);
    if (cfg.status === 'fulfilled') this.config.set(cfg.value);
    if (me.status === 'fulfilled') this.user.set(me.value.user);
    this.ready.set(true);
  }

  setUser(u: User | null) { this.user.set(u); }

  /** Re-read the session user — e.g. after the admin console edited the
   *  profile — so the dashboard stays right. */
  async refreshUser(): Promise<void> {
    try {
      const me = await firstValueFrom(this.api.me());
      this.user.set(me.user);
    } catch { /* keep what we have */ }
  }

  async logout(): Promise<void> {
    try { await firstValueFrom(this.api.logout()); } finally { this.user.set(null); }
  }
}
