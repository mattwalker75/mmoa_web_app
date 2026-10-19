import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="nav">
      <div class="container nav-inner">
        <a class="brand" routerLink="/">
          <span class="brand-mark">MM</span>
          <span class="brand-text">{{ auth.appTitle() }}</span>
        </a>

        <nav class="nav-links">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}">Home</a>
          <a (click)="goSection('mission')" style="cursor:pointer">Mission</a>
          <a (click)="goSection('events')" style="cursor:pointer">Events</a>
          <a (click)="goSection('involved')" style="cursor:pointer">Get involved</a>
        </nav>

        <div class="nav-cta">
          @if (auth.isLoggedIn()) {
            <a class="btn btn-ghost" routerLink="/dashboard">Member home</a>
            <button class="btn btn-dark" (click)="logout()">Sign out</button>
          } @else {
            <a class="btn btn-ghost" routerLink="/login">Sign in</a>
            @if (registrationOpen()) { <a class="btn btn-primary" routerLink="/signup">Join</a> }
          }
        </div>

        <button class="nav-burger" (click)="open.set(!open())" aria-label="Menu" [attr.aria-expanded]="open()">☰</button>
      </div>

      @if (open()) {
        <div class="nav-mobile container">
          <a routerLink="/" (click)="open.set(false)">Home</a>
          <a (click)="goSection('mission')">Mission</a>
          <a (click)="goSection('events')">Events</a>
          <a (click)="goSection('involved')">Get involved</a>
          @if (auth.isLoggedIn()) {
            <a routerLink="/dashboard" (click)="open.set(false)">Member home</a>
            <button class="btn btn-dark btn-block" (click)="logout()">Sign out</button>
          } @else {
            <a routerLink="/login" (click)="open.set(false)">Sign in</a>
            @if (registrationOpen()) { <a class="btn btn-primary btn-block" routerLink="/signup" (click)="open.set(false)">Join</a> }
          }
        </div>
      }
    </header>
  `,
  styles: [`
    .nav { position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,.9);
      backdrop-filter: saturate(180%) blur(12px); border-bottom: 1px solid var(--line); }
    .nav-inner { display: flex; align-items: center; gap: 18px; height: 70px; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; color: var(--ink); }
    .brand:hover { color: var(--ink); }
    .brand-mark { background: var(--brand-700); color: #fff; font-size: .78rem; letter-spacing: .04em;
      padding: 6px 8px; border-radius: 8px; }
    .brand-text { font-size: 1.05rem; letter-spacing: -.01em; }
    .nav-links { display: flex; gap: 4px; margin-left: 14px; flex: 1; }
    .nav-links a { color: var(--ink-soft); font-weight: 650; font-size: .92rem; padding: 8px 12px; border-radius: 8px; }
    .nav-links a:hover, .nav-links a.active { color: var(--brand-700); background: var(--surface-2); }
    .nav-cta { display: flex; align-items: center; gap: 10px; }
    .nav-cta .btn { padding: 9px 18px; font-size: .9rem; }
    .nav-burger { display: none; background: none; border: none; font-size: 1.4rem; cursor: pointer; }
    .nav-mobile { display: none; flex-direction: column; gap: 10px; padding: 16px 0 22px; }
    .nav-mobile a { font-weight: 650; color: var(--ink-soft); cursor: pointer; }
    @media (max-width: 860px) {
      .nav-links, .nav-cta { display: none; }
      .nav-burger { display: block; margin-left: auto; }
      .nav-mobile { display: flex; }
    }
  `]
})
export class NavComponent {
  auth = inject(AuthService);
  private router = inject(Router);
  open = signal(false);

  registrationOpen() { return this.auth.config()?.allowMemberRegistration !== false; }

  goSection(id: string) {
    this.open.set(false);
    this.router.navigate(['/'], { fragment: id });
  }

  async logout() {
    this.open.set(false);
    await this.auth.logout();
    this.router.navigateByUrl('/');
  }
}
