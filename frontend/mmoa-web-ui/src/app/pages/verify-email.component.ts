import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { apiError, apiCode } from '../core/errors';

/**
 * Landing page for the emailed verification link (/verify?token=…).
 *
 * The token is single-use, so it must NOT be consumed on page load: mail
 * scanners and link previewers fetch links before the person does, and the
 * SPA would then burn the token for them ("already verified" at best, a dead
 * link at worst). The page explains and waits for a click; only the button
 * sends the token. The testing bypass (DevLinkService / app-dev-link) lands
 * here the same way, so clicking the on-screen link also shows the button.
 */
@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card center rise">
        @if (state() === 'ready') {
          <h1>Confirm your email</h1>
          <p class="muted">You're almost done. Click the button below to confirm this email address and activate your login.</p>
          <button class="btn btn-primary" type="button" (click)="confirm()">Confirm my email</button>
        } @else if (state() === 'pending') {
          <div class="spinner light big" role="status" aria-label="Verifying" style="margin:0 auto 16px"></div>
          <h1>Verifying…</h1>
          <p class="muted">Hang tight while we confirm your email address.</p>
        } @else if (state() === 'ok') {
          <h1>Email verified!</h1>
          <p class="muted">Your login is active. Sign in to fill out your organization's profile.</p>
          <a class="btn btn-primary" routerLink="/login">Sign in</a>
        } @else {
          <h1>Verification failed</h1>
          <p class="muted">{{ error() }}</p>
          @if (canResend()) {
            <a class="btn btn-primary" routerLink="/verify-pending" [queryParams]="{ email: email() }">Request a new link</a>
          } @else {
            <a class="btn btn-ghost" routerLink="/signup">Back to sign up</a>
          }
        }
      </div>
    </div>
  `
})
export class VerifyEmailComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  state = signal<'ready' | 'pending' | 'ok' | 'error'>('ready');
  error = signal('');
  email = signal('');
  canResend = signal(false);

  private readonly token = this.route.snapshot.queryParamMap.get('token') || '';

  constructor() {
    if (!this.token) {
      this.state.set('error');
      this.error.set('This link is missing its token. Use the link from your email exactly as sent.');
    }
  }

  /** The button: this is the only place the token leaves the browser. */
  async confirm() {
    if (this.state() !== 'ready') return;
    this.state.set('pending');
    try {
      await firstValueFrom(this.api.verifyEmail(this.token));
      this.state.set('ok');
    } catch (err) {
      this.state.set('error');
      this.error.set(apiError(err, 'This verification link is not valid.'));
      if (apiCode(err) === 'expired') {
        this.canResend.set(true);
        this.email.set((err as any)?.error?.email || '');
      }
    }
  }
}
