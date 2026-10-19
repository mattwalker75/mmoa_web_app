import { HttpErrorResponse } from '@angular/common/http';

/** Pull a human message out of an API error response. */
export function apiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.error && typeof err.error === 'object' && err.error.error) return err.error.error as string;
    if (typeof err.error === 'string' && err.error) return err.error;
    if (err.status === 0) return 'Could not reach the server. Check your connection.';
  }
  return fallback;
}

/** Some 4xx responses carry a machine code (e.g. 'unverified', 'expired'). */
export function apiCode(err: unknown): string | null {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
    return (err.error.code as string) || null;
  }
  return null;
}
