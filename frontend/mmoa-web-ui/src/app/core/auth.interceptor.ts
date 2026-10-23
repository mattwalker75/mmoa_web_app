import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { AuthService } from './auth.service';

/** Calls where a 401 is an answer, not a lost session. */
const OWN_401 = ['/api/auth/me', '/api/auth/login'];

/**
 * A 401 from the API mid-session (cookie expired, password changed in another
 * tab, account deactivated) means the sign-in is gone: drop the in-memory user
 * and go to the login page, which brings the user back to where they were
 * after signing in. The error is still thrown, so the caller's own message
 * shows if for any reason the redirect doesn't happen.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(tap({
    error: (err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return;
      if (!req.url.startsWith('/api/') || OWN_401.some(p => req.url.startsWith(p))) return;
      if (!auth.isLoggedIn()) return;
      auth.setUser(null);
      router.navigate(['/login'], { queryParams: { redirect: router.url } });
    }
  }));
};
