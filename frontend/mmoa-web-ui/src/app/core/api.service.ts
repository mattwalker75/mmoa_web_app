import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  PublicConfig, User, SiteInfo, EventItem, Raffle, BoardMember, Category, City,
  SearchResponse, PublicOrg, OrgPreview, PortalPayload, OrgImage, LinkSentResponse, PortalMetrics
} from './models';

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

  // Public content
  config(): Observable<PublicConfig> { return this.http.get<PublicConfig>('/api/public/config', this.opts); }
  site(): Observable<SiteInfo> { return this.http.get<SiteInfo>('/api/site', this.opts); }
  events(when: 'upcoming' | 'past' = 'upcoming'): Observable<{ when: string; events: EventItem[] }> {
    return this.http.get<{ when: string; events: EventItem[] }>('/api/events', { ...this.opts, params: { when } });
  }
  /** `preview` = a console preview token (shows a draft / archived event). */
  event(slug: string, preview?: string | null): Observable<{ event: EventItem }> {
    const q = preview ? '?preview=' + encodeURIComponent(preview) : '';
    return this.http.get<{ event: EventItem }>('/api/events/' + encodeURIComponent(slug) + q, this.opts);
  }
  raffles(status: 'current' | 'past' = 'current'): Observable<{ status: string; raffles: Raffle[] }> {
    return this.http.get<{ status: string; raffles: Raffle[] }>('/api/raffles', { ...this.opts, params: { status } });
  }
  /** `preview` = a console preview token (shows a draft / hidden raffle). */
  raffle(slug: string, preview?: string | null): Observable<{ raffle: Raffle }> {
    const q = preview ? '?preview=' + encodeURIComponent(preview) : '';
    return this.http.get<{ raffle: Raffle }>('/api/raffles/' + encodeURIComponent(slug) + q, this.opts);
  }
  board(): Observable<{ board: BoardMember[] }> { return this.http.get<{ board: BoardMember[] }>('/api/board', this.opts); }

  // "Need Help?" directory
  directoryMeta(): Observable<{ categories: Category[]; cities: City[] }> {
    return this.http.get<{ categories: Category[]; cities: City[] }>('/api/directory/meta', this.opts);
  }
  directorySearch(q: { categories?: string[]; city?: string; q?: string }): Observable<SearchResponse> {
    let params = new HttpParams();
    if (q.categories?.length) params = params.set('category', q.categories.join(','));
    if (q.city) params = params.set('city', q.city);
    if (q.q) params = params.set('q', q.q);
    return this.http.get<SearchResponse>('/api/directory/search', { ...this.opts, params });
  }
  directoryOrg(id: number): Observable<{ org: PublicOrg }> {
    return this.http.get<{ org: PublicOrg }>('/api/directory/orgs/' + id, this.opts);
  }
  /** `token` = a console preview token: the org whatever its status, with preview_state. */
  orgPreview(id: number, token: string): Observable<OrgPreview> {
    return this.http.get<OrgPreview>('/api/directory/orgs/' + id + '?preview=' + encodeURIComponent(token), this.opts);
  }

  // Nonprofit portal
  portalOrg(): Observable<PortalPayload> { return this.http.get<PortalPayload>('/api/portal/org', this.opts); }
  /** Activity counts for the signed-in org's profile (searches, views, link clicks). */
  portalMetrics(): Observable<PortalMetrics> { return this.http.get<PortalMetrics>('/api/portal/metrics', this.opts); }
  savePortalOrg(body: Record<string, unknown>): Observable<PortalPayload> {
    return this.http.put<PortalPayload>('/api/portal/org', body, this.opts);
  }
  uploadOrgImage(file: Blob, alt: string): Observable<{ ok: boolean; image: OrgImage; images: OrgImage[] }> {
    const fd = new FormData();
    fd.append('image', file, 'photo.jpg');
    if (alt) fd.append('alt', alt);
    return this.http.post<{ ok: boolean; image: OrgImage; images: OrgImage[] }>('/api/portal/org/images', fd, this.opts);
  }
  deleteOrgImage(id: number): Observable<{ ok: boolean; images: OrgImage[] }> {
    return this.http.delete<{ ok: boolean; images: OrgImage[] }>('/api/portal/org/images/' + id, this.opts);
  }
  orderOrgImages(order: number[], alt: Record<string, string>): Observable<{ ok: boolean; images: OrgImage[] }> {
    return this.http.put<{ ok: boolean; images: OrgImage[] }>('/api/portal/org/images/order', { order, alt }, this.opts);
  }

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
