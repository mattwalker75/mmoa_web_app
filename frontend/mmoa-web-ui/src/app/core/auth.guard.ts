import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Requires a signed-in user; bounces guests to /login (preserving intent). */
export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn()) return true;
  return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
};

/** For /login: reaching the sign-in page while already signed in (the
 *  footer's "Sign in" link, a stale bookmark) ends the current session first,
 *  so the form that appears is a real sign-in and never a no-op over a live
 *  session. (Signup is NOT guarded this way: a signed-in user may really
 *  want a second account, so that page asks instead.) */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return true;
  await auth.logout();
  return router.createUrlTree(['/login'], { queryParams: { signedOut: 1 } });
};
