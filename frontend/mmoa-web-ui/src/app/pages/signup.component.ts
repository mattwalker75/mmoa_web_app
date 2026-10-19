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
          <h1>Join {{ appTitle() }}</h1>
          <p class="muted">Create your member account. We'll email you a link to verify your address.</p>
        </div>

        @if (!registrationOpen()) {
          <div class="alert alert-info">New member sign-up is closed right now. Please check back later.</div>
          <div class="auth-foot">Already a member? <a routerLink="/login">Sign in</a></div>
        } @else if (loggedIn()) {
          <!-- Reached while signed in — a "Join" link or a bookmark. Don't
               offer the form; ask what they meant. -->
          <div class="alert alert-info">You're signed in as <strong>{{ signedInAs() }}</strong>.</div>
          <p class="muted">To create a different account, sign out first. Otherwise, head to your member home.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-dark" type="button" (click)="signOutAndContinue()" [disabled]="loading()">Sign out and create a new account</button>
            <button class="btn btn-ghost" type="button" (click)="goDashboard()">Go to member home</button>
          </div>
        } @else {
        @if (error()) { <div class="alert alert-error">{{ error() }}</div> }

        <form (ngSubmit)="submit()">
          <div class="grid-2">
            <div class="field">
              <label>First name</label>
              <input class="input" name="first_name" [(ngModel)]="m.first_name" autocomplete="given-name" required>
            </div>
            <div class="field">
              <label>Last name</label>
              <input class="input" name="last_name" [(ngModel)]="m.last_name" autocomplete="family-name" required>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label>Login name</label>
              <input class="input" name="login_name" [(ngModel)]="m.login_name" autocomplete="username" required>
              <span class="hint">Unique — used to sign in. 3–30 letters, numbers, . _ -</span>
            </div>
            <div class="field">
              <label>Email</label>
              <input class="input" type="email" name="email" [(ngModel)]="m.email" autocomplete="email" required>
            </div>
          </div>

          <div class="field">
            <label>Phone number <span class="muted">(optional)</span></label>
            <input class="input" type="tel" name="phone_number" inputmode="tel" maxlength="12"
              autocomplete="tel"
              [ngModel]="m.phone_number" (ngModelChange)="formatPhone($event)">
          </div>

          <div class="grid-2">
            <div class="field">
              <label>Password</label>
              <app-password-input [(value)]="m.password" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" [minlength]="minLen()" />
              <span class="hint">At least {{ minLen() }} characters. Show/Hide reveals both fields.</span>
            </div>
            <div class="field">
              <label>Confirm password</label>
              <app-password-input [(value)]="m.confirm_password" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" />
            </div>
          </div>

          <button class="btn btn-primary btn-block" type="submit" [disabled]="loading()">
            @if (loading()) { <span class="spinner"></span> } @else { Create account }
          </button>
        </form>

        <div class="auth-foot">
          Already a member? <a routerLink="/login">Sign in</a>
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

  m = { login_name: '', first_name: '', last_name: '', phone_number: '', email: '', password: '', confirm_password: '' };
  loading = signal(false);
  error = signal('');
  showPw = signal(false);

  appTitle() { return this.auth.appTitle(); }
  minLen() { return this.auth.config()?.passwordMinLength || 8; }
  registrationOpen() { return this.auth.config()?.allowMemberRegistration !== false; }

  loggedIn() { return this.auth.isLoggedIn(); }
  signedInAs() { const u = this.auth.user(); return u?.email || u?.login_name || 'your account'; }
  goDashboard() { this.router.navigateByUrl('/dashboard'); }
  /** Sign out in place: once the session is gone the form renders here. */
  async signOutAndContinue() {
    this.loading.set(true);
    try { await this.auth.logout(); } finally { this.loading.set(false); }
  }

  /** Format a US phone as the user types: 123-456-7890 (max 10 digits). */
  formatPhone(v: string) {
    const d = (v || '').replace(/\D/g, '').slice(0, 10);
    let out = d;
    if (d.length > 6) out = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    else if (d.length > 3) out = `${d.slice(0, 3)}-${d.slice(3)}`;
    this.m.phone_number = out;
  }

  async submit() {
    if (this.loading()) return;
    this.error.set('');
    if (!this.m.login_name || !this.m.first_name || !this.m.last_name || !this.m.email || !this.m.password) {
      this.error.set('Please fill in all required fields.'); return;
    }
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
      this.error.set(apiError(err, 'Could not create your account.'));
    } finally {
      this.loading.set(false);
    }
  }
}
