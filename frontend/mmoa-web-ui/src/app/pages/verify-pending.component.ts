import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { DevLinkService } from '../core/dev-link.service';
import { DevLinkComponent } from '../shared/dev-link.component';

@Component({
  selector: 'app-verify-pending',
  standalone: true,
  imports: [RouterLink, DevLinkComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card center rise">
        <div style="font-size:3rem;line-height:1">📬</div>
        <h1>Check your email</h1>
        @if (email()) {
          <p class="muted">We sent a verification link to <strong>{{ email() }}</strong>.</p>
        } @else {
          <p class="muted">We sent you a verification link.</p>
        }
        <p class="muted">Click the link in that email to activate your account, then sign in.</p>

        <!-- TESTING bypass (email.showLinksInBrowser): the link, on screen. -->
        <app-dev-link [link]="devLink()" action="verify your email" />

        @if (msg()) { <div class="alert alert-success">{{ msg() }}</div> }

        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:8px">
          <a class="btn btn-primary" routerLink="/login">Go to sign in</a>
          <button class="btn btn-ghost" (click)="resend()" [disabled]="sending() || !email()">
            @if (sending()) { <span class="spinner" style="border-color:rgba(0,0,0,.2);border-top-color:#333"></span> } @else { Resend email }
          </button>
        </div>
        <p class="muted" style="margin-top:16px;font-size:.85rem">Didn't get it? Check your spam folder.</p>
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

  async resend() {
    if (!this.email() || this.sending()) return;
    this.sending.set(true);
    try {
      const res = await firstValueFrom(this.api.resendVerification(this.email()));
      this.msg.set(res.message);
      if (res.devLink) this.devLink.set(res.devLink);
    } catch {
      this.msg.set('');
    } finally {
      this.sending.set(false);
    }
  }
}
