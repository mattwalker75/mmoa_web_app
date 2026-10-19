import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PublicConfig, User, ContentResponse, EventsResponse, LinkSentResponse } from './models';

/**
 * Thin wrapper over the Express JSON API. Every call uses
 * `withCredentials: true` so the cookie-session cookie rides along — the SPA
 * and API are same-origin in production (Express serves the build), and the
 * dev server proxies /api to Express.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private opts = { withCredentials: true };

  // Public
  config(): Observable<PublicConfig> { return this.http.get<PublicConfig>('/api/public/config', this.opts); }
  content(): Observable<ContentResponse> { return this.http.get<ContentResponse>('/api/content', this.opts); }
  events(): Observable<EventsResponse> { return this.http.get<EventsResponse>('/api/events', this.opts); }

  // Auth
  me(): Observable<{ user: User | null }> { return this.http.get<{ user: User | null }>('/api/auth/me', this.opts); }
  login(body: { identifier: string; password: string }): Observable<{ user: User }> {
    return this.http.post<{ user: User }>('/api/auth/login', body, this.opts);
  }
  signup(body: Record<string, string>): Observable<LinkSentResponse> {
    return this.http.post<LinkSentResponse>('/api/auth/signup', body, this.opts);
  }
  logout(): Observable<{ ok: boolean }> { return this.http.post<{ ok: boolean }>('/api/auth/logout', {}, this.opts); }
  verifyEmail(token: string): Observable<{ ok: boolean; alreadyVerified?: boolean }> {
    return this.http.post<{ ok: boolean; alreadyVerified?: boolean }>('/api/auth/verify', { token }, this.opts);
  }
  resendVerification(email: string): Observable<LinkSentResponse> {
    return this.http.post<LinkSentResponse>('/api/auth/resend-verification', { email }, this.opts);
  }
  forgotPassword(email: string): Observable<LinkSentResponse> {
    return this.http.post<LinkSentResponse>('/api/auth/forgot-password', { email }, this.opts);
  }
  resetPassword(body: { token: string; password: string; confirm_password: string }): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>('/api/auth/reset-password', body, this.opts);
  }
  /** Non-consuming check so the reset page can refuse a dead link on load
   *  instead of after the user has typed a new password twice. */
  resetPasswordCheck(token: string): Observable<{ ok: boolean; code?: 'expired' | 'used' | 'superseded' | 'invalid' }> {
    return this.http.post<{ ok: boolean; code?: 'expired' | 'used' | 'superseded' | 'invalid' }>('/api/auth/reset-password/check', { token }, this.opts);
  }
  changePassword(body: { current_password: string; new_password: string; confirm_password: string }): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>('/api/auth/change-password', body, this.opts);
  }
}
