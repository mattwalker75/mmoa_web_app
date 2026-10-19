import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PasswordInputComponent } from '../shared/password-input.component';
import { EventItem } from '../core/models';
import { apiError } from '../core/errors';

/**
 * Member home: profile summary, change password, and upcoming events.
 * Profile edits (name, email, phone, role, active) are made by organizers
 * in the admin console; the profile is re-read on load so those show up
 * without a re-login.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, DatePipe, PasswordInputComponent],
  template: `
    <div class="page-shell">
      <div class="dash-head rise">
        <div>
          <h1>Welcome, {{ firstName() }}</h1>
          <p class="muted">Thanks for serving with {{ appTitle() }}.</p>
        </div>
        <div class="dash-actions">
          <button class="btn btn-ghost" (click)="openChangePw()">Change password</button>
        </div>
      </div>

      <div class="dash-grid">
        <section class="card rise">
          <h3>Your profile</h3>
          @if (user(); as u) {
            <dl class="profile">
              <dt>Name</dt><dd>{{ u.first_name }} {{ u.last_name }}</dd>
              <dt>Login name</dt><dd>{{ u.login_name }}</dd>
              <dt>Email</dt><dd>{{ u.email }}</dd>
              <dt>Phone</dt><dd>{{ u.phone_number || '—' }}</dd>
              @if (u.created_at) { <dt>Member since</dt><dd>{{ u.created_at | date:'mediumDate' }}</dd> }
              @if (u.role === 'admin') { <dt>Role</dt><dd>Organizer</dd> }
            </dl>
          }
          <p class="muted small">Need to change your name, email or phone? Contact an organizer.</p>
        </section>

        <section class="card rise rise-2">
          <div class="sec-head">
            <h3>Upcoming events</h3>
            @if (loadingEvents()) { <span class="muted small">Loading…</span> }
          </div>
          @if (eventsError()) {
            <p class="muted">We couldn't load events just now. Please try again later.</p>
          } @else if (upcoming().length) {
            <ul class="event-list">
              @for (e of upcoming(); track e.event_id) {
                <li>
                  <strong>{{ e.title }}</strong>
                  <span class="muted small">
                    {{ e.starts_at | date:'EEE, MMM d, y · h:mm a' }}@if (e.location) { · {{ e.location }} }
                  </span>
                </li>
              }
            </ul>
          } @else if (!loadingEvents()) {
            <p class="muted">No upcoming events right now — check back soon.</p>
          }
        </section>
      </div>
    </div>

    <!-- Change account password modal -->
    @if (changePwOpen()) {
      <div class="modal-backdrop" (click)="closeChangePw()">
        <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="changePwTitle" tabindex="-1" (click)="$event.stopPropagation()">
          <h3 id="changePwTitle">Change your password</h3>
          <p class="muted">Update the password for your {{ appTitle() }} account.</p>

          @if (changePwErr()) { <div class="alert alert-error">{{ changePwErr() }}</div> }
          @if (changePwMsg()) { <div class="alert alert-success">{{ changePwMsg() }}</div> }

          @if (!changePwMsg()) {
            <div class="field">
              <label>Current password</label>
              <app-password-input [(value)]="curPw" autocomplete="current-password" />
            </div>
            <div class="field">
              <label>New password</label>
              <app-password-input [(value)]="newPw" [show]="showNewPw()" (showChange)="showNewPw.set($event)" autocomplete="new-password" [minlength]="minLen()" />
              <span class="hint">At least {{ minLen() }} characters. Show/Hide reveals both new-password fields.</span>
            </div>
            <div class="field">
              <label>Confirm new password</label>
              <app-password-input [(value)]="newPwConfirm" [show]="showNewPw()" (showChange)="showNewPw.set($event)" autocomplete="new-password" />
            </div>
          }

          <div class="modal-actions">
            @if (changePwMsg()) {
              <button class="btn btn-primary" (click)="closeChangePw()">Done</button>
            } @else {
              <button class="btn btn-ghost" (click)="closeChangePw()" [disabled]="changePwLoading()">Cancel</button>
              <button class="btn btn-primary" (click)="submitChangePw()" [disabled]="changePwLoading()">
                @if (changePwLoading()) { <span class="spinner"></span> } @else { Update password }
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .dash-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
    .dash-head h1 { font-size: 2rem; margin: 0; }
    .dash-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .dash-grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 22px; align-items: start; }
    @media (max-width: 820px) { .dash-grid { grid-template-columns: 1fr; } }
    .sec-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .sec-head h3 { margin: 0; }
    .small { font-size: .85rem; }
    .profile { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; margin: 0 0 16px; }
    .profile dt { color: var(--muted); font-size: .85rem; font-weight: 650; }
    .profile dd { margin: 0; word-break: break-word; }
    .event-list { list-style: none; margin: 0; padding: 0; }
    .event-list li { display: flex; flex-direction: column; gap: 2px; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .event-list li:last-child { border-bottom: none; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(11,20,40,.45); display: grid; place-items: center; padding: 20px; z-index: 100; }
    .modal { width: 100%; max-width: 440px; position: relative; }
    .modal h3 { margin-top: 0; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
  `]
})
export class DashboardComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  user = this.auth.user;
  firstName = computed(() => this.auth.user()?.first_name || this.auth.user()?.login_name || 'there');
  appTitle() { return this.auth.appTitle(); }
  minLen() { return this.auth.config()?.passwordMinLength || 8; }

  upcoming = signal<EventItem[]>([]);
  loadingEvents = signal(true);
  eventsError = signal(false);

  // Change-account-password modal state.
  changePwOpen = signal(false);
  curPw = '';
  newPw = '';
  newPwConfirm = '';
  showNewPw = signal(false);
  changePwLoading = signal(false);
  changePwMsg = signal('');
  changePwErr = signal('');

  constructor() {
    this.auth.refreshUser();
    this.loadEvents();
  }

  private async loadEvents() {
    try {
      const res = await firstValueFrom(this.api.events());
      this.upcoming.set((res.events || []).filter(e => e.is_upcoming));
    } catch {
      this.eventsError.set(true);
    } finally {
      this.loadingEvents.set(false);
    }
  }

  openChangePw() {
    this.changePwOpen.set(true);
    this.curPw = ''; this.newPw = ''; this.newPwConfirm = '';
    this.showNewPw.set(false);
    this.changePwMsg.set(''); this.changePwErr.set('');
  }
  closeChangePw() { this.changePwOpen.set(false); }

  async submitChangePw() {
    if (this.changePwLoading()) return;
    this.changePwErr.set(''); this.changePwMsg.set('');
    if (!this.curPw) { this.changePwErr.set('Enter your current password.'); return; }
    if (this.newPw.length < this.minLen()) { this.changePwErr.set(`New password must be at least ${this.minLen()} characters.`); return; }
    if (this.newPw !== this.newPwConfirm) { this.changePwErr.set('New passwords do not match.'); return; }
    if (this.newPw === this.curPw) { this.changePwErr.set('Choose a password different from your current one.'); return; }
    this.changePwLoading.set(true);
    try {
      const res = await firstValueFrom(this.api.changePassword({
        current_password: this.curPw,
        new_password: this.newPw,
        confirm_password: this.newPwConfirm
      }));
      this.curPw = ''; this.newPw = ''; this.newPwConfirm = '';
      this.changePwMsg.set(res.message || 'Your password has been updated.');
    } catch (err) {
      this.changePwErr.set(apiError(err, 'Could not update your password.'));
    } finally {
      this.changePwLoading.set(false);
    }
  }

  // Escape closes the modal (dialogs should be keyboard-dismissible). A full
  // focus-trap is a larger change and is not attempted here.
  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.changePwOpen()) this.closeChangePw();
  }
}
