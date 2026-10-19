import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { DevLinkService } from '../core/dev-link.service';
import { PasswordInputComponent } from '../shared/password-input.component';
import { apiError } from '../core/errors';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [FormsModule, RouterLink, PasswordInputComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card wide card rise">
        <div class="auth-head">
          <span class="kicker">Partner with Mission Men of Anna</span>
          <h1>Create your nonprofit login</h1>
          <p class="muted">Free for local nonprofits. After you confirm your email you can fill out your profile; it appears in "Need Help?" once we verify your EIN.</p>
        </div>

        @if (!registrationOpen()) {
          <div class="alert alert-info">New nonprofit sign-up is paused right now. Please check back later or call us.</div>
          <div class="auth-foot">Already have a login? <a routerLink="/login">Sign in</a></div>
        } @else if (loggedIn()) {
          <!-- Reached while signed in — a link or a bookmark. Don't offer the
               form; ask what they meant. -->
          <div class="alert alert-info">You're signed in as <strong>{{ signedInAs() }}</strong>.</div>
          <p class="muted">Each login belongs to one organization. To create a login for a different organization, sign out first.</p>
          <div class="btn-row">
            <button class="btn btn-outline" type="button" (click)="signOutAndContinue()" [disabled]="loading()">Sign out and create a new login</button>
            <button class="btn btn-primary" type="button" (click)="goPortal()">Go to my profile</button>
          </div>
        } @else {
        @if (error()) { <div class="alert alert-error" role="alert">{{ error() }}</div> }

        <form (ngSubmit)="submit()" novalidate>
          <h2 class="form-section">Your organization</h2>
          <div class="grid-2">
            <div class="field">
              <label for="su-org">Organization name</label>
              <input id="su-org" class="input" name="org_name" [(ngModel)]="m.org_name" autocomplete="organization" maxlength="200" required>
            </div>
            <div class="field">
              <label for="su-ein">EIN (federal tax ID)</label>
              <input id="su-ein" class="input" name="ein" inputmode="numeric" maxlength="10" placeholder="12-3456789"
                [ngModel]="m.ein" (ngModelChange)="formatEin($event)" required aria-describedby="su-ein-hint">
              <span class="hint" id="su-ein-hint">9 digits. Never shown publicly — we use it to confirm your 501(c)(3) status.</span>
            </div>
          </div>

          <h2 class="form-section">Primary contact</h2>
          <div class="grid-2">
            <div class="field">
              <label for="su-first">First name</label>
              <input id="su-first" class="input" name="first_name" [(ngModel)]="m.first_name" autocomplete="given-name" required>
            </div>
            <div class="field">
              <label for="su-last">Last name</label>
              <input id="su-last" class="input" name="last_name" [(ngModel)]="m.last_name" autocomplete="family-name" required>
            </div>
          </div>
          <div class="field">
            <label for="su-email">Email</label>
            <input id="su-email" class="input" type="email" name="email" [(ngModel)]="m.email" autocomplete="email" required aria-describedby="su-email-hint">
            <span class="hint" id="su-email-hint">For signing in and messages from MMoA. It isn't shown publicly (you can add a public email to your profile).</span>
          </div>

          <h2 class="form-section">Login</h2>
          <div class="field">
            <label for="su-login">Login name</label>
            <input id="su-login" class="input" name="login_name" [(ngModel)]="m.login_name" autocomplete="username" required aria-describedby="su-login-hint">
            <span class="hint" id="su-login-hint">3–30 letters, numbers, . _ - (you can also sign in with your email)</span>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="su-pw">Password</label>
              <app-password-input inputId="su-pw" [(value)]="m.password" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" [minlength]="minLen()" />
              <span class="hint">At least {{ minLen() }} characters. Show/Hide reveals both fields.</span>
            </div>
            <div class="field">
              <label for="su-pw2">Confirm password</label>
              <app-password-input inputId="su-pw2" [(value)]="m.confirm_password" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" />
            </div>
          </div>

          <button class="btn btn-primary btn-lg btn-block" type="submit" [disabled]="loading()">
            @if (loading()) { <span class="spinner" role="status" aria-label="Creating your login"></span> } @else { Create my login }
          </button>
        </form>

        <div class="auth-foot">
          Already have a login? <a routerLink="/login">Sign in</a>
        </div>
        }
      </div>
    </div>
  `
})
export class SignupComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private devLinks = inject(DevLinkService);
  private router = inject(Router);

  m = { org_name: '', ein: '', login_name: '', first_name: '', last_name: '', email: '', password: '', confirm_password: '' };
  loading = signal(false);
  error = signal('');
  showPw = signal(false);

  appTitle() { return this.auth.appTitle(); }
  minLen() { return this.auth.config()?.passwordMinLength || 8; }
  registrationOpen() { return this.auth.config()?.allowMemberRegistration !== false; }

  loggedIn() { return this.auth.isLoggedIn(); }
  signedInAs() { const u = this.auth.user(); return u?.email || u?.login_name || 'your account'; }
  goPortal() { this.router.navigateByUrl('/portal'); }
  /** Sign out in place: once the session is gone the form renders here. */
  async signOutAndContinue() {
    this.loading.set(true);
    try { await this.auth.logout(); } finally { this.loading.set(false); }
  }

  /** Format an EIN as the user types: 12-3456789. */
  formatEin(v: string) {
    const d = (v || '').replace(/\D/g, '').slice(0, 9);
    this.m.ein = d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
  }

  async submit() {
    if (this.loading()) return;
    this.error.set('');
    if (!this.m.org_name || !this.m.ein || !this.m.login_name || !this.m.first_name || !this.m.last_name || !this.m.email || !this.m.password) {
      this.error.set('Please fill in all required fields.'); return;
    }
    if (!/^\d{2}-?\d{7}$/.test(this.m.ein)) { this.error.set('EIN must be 9 digits (for example 12-3456789).'); return; }
    if (this.m.password.length < this.minLen()) { this.error.set(`Password must be at least ${this.minLen()} characters.`); return; }
    if (this.m.password !== this.m.confirm_password) { this.error.set('Passwords do not match.'); return; }

    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.signup({ ...this.m }));
      // TESTING bypass: carry the verification link to the next page in
      // memory (never in the URL). No-op when the server didn't send one.
      this.devLinks.set(res.devLink);
      this.router.navigate(['/verify-pending'], { queryParams: { email: res.email } });
    } catch (err) {
      this.error.set(apiError(err, 'Could not create your login.'));
    } finally {
      this.loading.set(false);
    }
  }
}
