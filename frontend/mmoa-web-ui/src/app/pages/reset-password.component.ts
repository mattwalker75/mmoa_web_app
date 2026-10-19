import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PasswordInputComponent } from '../shared/password-input.component';
import { apiError } from '../core/errors';

/** What the server said about the link on load. 'checking' until it answers. */
type LinkState = 'checking' | 'valid' | 'expired' | 'used' | 'superseded' | 'invalid';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink, PasswordInputComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card rise">
        <div class="auth-head">
          <h1>Choose a new password</h1>
          <p class="muted">This link works once. Pick a strong password you'll remember.</p>
        </div>

        @if (state() === 'checking') {
          <p class="muted center"><span class="spinner"></span> Checking your reset link…</p>
        } @else if (state() !== 'valid') {
          <!-- Dead link: say why, offer the way out, and never show the form. -->
          <div class="alert alert-error">{{ linkMessage() }}</div>
          <a class="btn btn-primary btn-block" routerLink="/forgot-password">Resend reset link</a>
        } @else if (done()) {
          <div class="alert alert-success">{{ message() }}</div>
          <a class="btn btn-primary btn-block" routerLink="/login">Sign in</a>
        } @else {
          @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
          <form (ngSubmit)="submit()">
            <div class="field">
              <label>New password</label>
              <app-password-input [(value)]="password" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" [minlength]="minLen()" />
              <span class="hint">At least {{ minLen() }} characters. Show/Hide reveals both fields.</span>
            </div>
            <div class="field">
              <label>Confirm new password</label>
              <app-password-input [(value)]="confirm" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" />
            </div>
            <button class="btn btn-primary btn-block" type="submit" [disabled]="loading()">
              @if (loading()) { <span class="spinner"></span> } @else { Reset password }
            </button>
          </form>
        }
      </div>
    </div>
  `
})
export class ResetPasswordComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  token = this.route.snapshot.queryParamMap.get('token') || '';
  password = '';
  confirm = '';
  // One toggle for both fields, like signup and the dashboard modals.
  showPw = signal(false);
  state = signal<LinkState>('checking');
  loading = signal(false);
  done = signal(false);
  message = signal('');
  error = signal('');

  constructor() { this.checkLink(); }

  minLen() { return this.auth.config()?.passwordMinLength || 8; }

  linkMessage(): string {
    switch (this.state()) {
      case 'expired':
        return 'This reset link has expired. Request a new one below.';
      case 'used':
        return "This reset link has already been used. If that wasn't you, request a new link now and change your password.";
      case 'superseded':
        return 'This reset link was replaced by a newer one. Check your inbox for the latest email, or request another below.';
      default:
        return this.token ? "This reset link isn't valid." : 'This reset link is missing its token.';
    }
  }

  /** Ask the server whether the link is still good WITHOUT consuming it. */
  private async checkLink() {
    if (!this.token) { this.state.set('invalid'); return; }
    try {
      const res = await firstValueFrom(this.api.resetPasswordCheck(this.token));
      this.state.set(res.ok ? 'valid' : (res.code || 'invalid'));
    } catch {
      // The pre-check is a courtesy, not the security boundary: if it can't
      // be reached, show the form — submit re-validates on the server anyway.
      this.state.set('valid');
    }
  }

  async submit() {
    if (this.loading()) return;
    this.error.set('');
    if (this.password.length < this.minLen()) { this.error.set(`Password must be at least ${this.minLen()} characters.`); return; }
    if (this.password !== this.confirm) { this.error.set('Passwords do not match.'); return; }
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.resetPassword({ token: this.token, password: this.password, confirm_password: this.confirm }));
      this.message.set(res.message);
      this.done.set(true);
    } catch (err) {
      this.error.set(apiError(err, 'Could not reset your password.'));
    } finally {
      this.loading.set(false);
    }
  }
}
