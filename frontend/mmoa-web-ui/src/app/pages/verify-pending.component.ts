import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { DevLinkService } from '../core/dev-link.service';
import { DevLinkComponent } from '../shared/dev-link.component';
import { apiError } from '../core/errors';

@Component({
  selector: 'app-verify-pending',
  standalone: true,
  imports: [RouterLink, DevLinkComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card center rise">
        <h1>Check your email</h1>
        @if (email()) {
          <p class="muted">We sent a verification link to <strong>{{ email() }}</strong>.</p>
        } @else {
          <p class="muted">We sent you a verification link.</p>
        }
        <p class="muted">Click the link in that email to activate your login, then sign in and fill out your organization's profile.</p>

        <!-- TESTING bypass (email.showLinksInBrowser): the link, on screen. -->
        <app-dev-link [link]="devLink()" action="verify your email" />

        @if (msg()) { <div class="alert alert-success">{{ msg() }}</div> }
        @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }

        <div class="btn-row" style="justify-content:center;margin-top:8px">
          <a class="btn btn-primary" routerLink="/login">Go to sign in</a>
          <button class="btn btn-ghost" (click)="resend()" [disabled]="sending() || !email()">
            @if (sending()) { <span class="spinner light"></span> } @else { Resend email }
          </button>
        </div>
        <p class="muted small" style="margin-top:16px">Didn't get it? Check your spam folder.</p>
      </div>
    </div>
  `
})
export class VerifyPendingComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  email = signal(this.route.snapshot.queryParamMap.get('email') || '');
  // Handed over by the signup page (one-shot, in memory); a resend replaces it.
  devLink = signal<string | null>(inject(DevLinkService).take());
  sending = signal(false);
  msg = signal('');
  err = signal('');

  async resend() {
    if (!this.email() || this.sending()) return;
    this.sending.set(true);
    this.msg.set(''); this.err.set('');
    try {
      const res = await firstValueFrom(this.api.resendVerification(this.email()));
      this.msg.set(res.message);
      if (res.devLink) this.devLink.set(res.devLink);
    } catch (e) {
      this.err.set(apiError(e, "We couldn't send the email just now. Please try again in a moment."));
    } finally {
      this.sending.set(false);
    }
  }
}
