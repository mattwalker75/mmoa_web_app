import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { DevLinkComponent } from '../shared/dev-link.component';
import { apiError } from '../core/errors';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink, DevLinkComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card rise">
        <div class="auth-head">
          <h1>Reset your password</h1>
          <p class="muted">Enter your account email and we'll send a single-use reset link.</p>
        </div>

        @if (sent()) {
          <div class="alert alert-success">{{ message() }}</div>
          <!-- TESTING bypass (email.showLinksInBrowser): the link, on screen. -->
          <app-dev-link [link]="devLink()" action="choose a new password" />
          <a class="btn btn-ghost btn-block" routerLink="/login">Back to sign in</a>
        } @else {
          @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
          <form (ngSubmit)="submit()">
            <div class="field">
              <label for="fp-email">Email</label>
              <input id="fp-email" class="input" type="email" name="email" [(ngModel)]="email" autocomplete="email" required>
            </div>
            <button class="btn btn-primary btn-block" type="submit" [disabled]="loading()">
              @if (loading()) { <span class="spinner"></span> } @else { Send reset link }
            </button>
          </form>
          <div class="auth-foot"><a routerLink="/login">Back to sign in</a></div>
        }
      </div>
    </div>
  `
})
export class ForgotPasswordComponent {
  private api = inject(ApiService);
  email = '';
  loading = signal(false);
  sent = signal(false);
  message = signal('');
  error = signal('');
  devLink = signal<string | null>(null);

  async submit() {
    if (this.loading()) return;
    this.error.set('');
    if (!this.email) { this.error.set('Please enter your email.'); return; }
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.forgotPassword(this.email));
      this.message.set(res.message);
      this.devLink.set(res.devLink || null);
      this.sent.set(true);
    } catch (err) {
      this.error.set(apiError(err));
    } finally {
      this.loading.set(false);
    }
  }
}
