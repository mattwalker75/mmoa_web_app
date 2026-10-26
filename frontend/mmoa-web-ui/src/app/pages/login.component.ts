import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PasswordInputComponent } from '../shared/password-input.component';
import { apiError, apiCode } from '../core/errors';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink, PasswordInputComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card rise">
        <div class="auth-head">
          <h1>Nonprofit login</h1>
          <p class="muted">Sign in to keep your organization's "Need Help?" profile up to date.</p>
        </div>

        @if (signedOut()) { <div class="alert alert-info">You've been signed out. Sign in again below.</div> }
        @if (error()) { <div class="alert alert-error" role="alert">{{ error() }}</div> }

        <form (ngSubmit)="submit()">
          <div class="field">
            <label for="li-id">Login name or email</label>
            <input id="li-id" class="input" name="identifier" [(ngModel)]="identifier" autocomplete="username" required>
          </div>
          <div class="field">
            <label for="li-pw">Password</label>
            <app-password-input inputId="li-pw" [(value)]="password" autocomplete="current-password" />
            <a class="hint" routerLink="/forgot-password">Forgot your password?</a>
          </div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="loading()">
            @if (loading()) { <span class="spinner" role="status" aria-label="Signing in"></span> } @else { Sign in }
          </button>
        </form>

        @if (registrationOpen()) {
          <div class="auth-foot">
            New partner nonprofit? <a routerLink="/signup">Create a login</a>
          </div>
        }
      </div>
    </div>
  `
})
export class LoginComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  identifier = '';
  password = '';
  loading = signal(false);
  error = signal('');

  appTitle() { return this.auth.appTitle(); }
  registrationOpen() { return this.auth.config()?.allowMemberRegistration !== false; }
  /** Set by the /login guard when it ended a live session to get here. */
  signedOut() { return this.route.snapshot.queryParamMap.get('signedOut') === '1'; }

  async submit() {
    if (this.loading()) return;
    this.error.set('');
    if (!this.identifier || !this.password) { this.error.set('Enter your login and password.'); return; }
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.login({ identifier: this.identifier, password: this.password }));
      this.auth.setUser(res.user);
      const redirect = this.route.snapshot.queryParamMap.get('redirect');
      // Only honor same-origin absolute paths. Reject protocol-relative
      // ("//evil.com") and backslash variants so ?redirect= can't bounce the
      // user to an external site after login (open redirect) — and /login
      // itself, whose guard would end the brand-new session on arrival.
      const safe = !!redirect && redirect.startsWith('/') && redirect[1] !== '/' && redirect[1] !== '\\' && !/^\/login(?=$|[/?#])/.test(redirect);
      this.router.navigateByUrl(safe ? redirect! : '/portal');
    } catch (err) {
      if (apiCode(err) === 'unverified') {
        const email = (err as any)?.error?.email || this.identifier;
        this.router.navigate(['/verify-pending'], { queryParams: { email } });
        return;
      }
      this.error.set(apiError(err, 'Could not sign you in.'));
    } finally {
      this.loading.set(false);
    }
  }
}
