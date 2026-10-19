import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { apiError, apiCode } from '../core/errors';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card center rise">
        @if (state() === 'pending') {
          <div class="spinner dark" style="margin:0 auto 16px;border-color:rgba(19,41,75,.2);border-top-color:var(--brand-700);width:30px;height:30px"></div>
          <h1>Verifying…</h1>
          <p class="muted">Hang tight while we confirm your email address.</p>
        } @else if (state() === 'ok') {
          <div style="font-size:3rem">✅</div>
          <h1>Email verified!</h1>
          <p class="muted">Your account is active. You can sign in now.</p>
          <a class="btn btn-primary" routerLink="/login">Sign in</a>
        } @else {
          <div style="font-size:3rem">⚠️</div>
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
  private router = inject(Router);

  state = signal<'pending' | 'ok' | 'error'>('pending');
  error = signal('');
  email = signal('');
  canResend = signal(false);

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!token) {
      this.state.set('error');
      this.error.set('This link is missing its token. Use the link from your email exactly as sent.');
      return;
    }
    this.run(token);
  }

  private async run(token: string) {
    try {
      await firstValueFrom(this.api.verifyEmail(token));
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
