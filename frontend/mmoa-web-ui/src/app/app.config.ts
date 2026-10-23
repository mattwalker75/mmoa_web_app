import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { AuthService } from './core/auth.service';
import { authInterceptor } from './core/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Session + public config are loaded before the first navigation, so route
    // guards always see the real signed-in state — including on a full page
    // load from a plain link like the footer's /login.
    provideAppInitializer(() => inject(AuthService).bootstrap()),
    provideRouter(
      routes,
      // Scrolling is handled in App (see handleScroll): the router's own
      // 'enabled' mode jumps to the top on EVERY navigation, including the
      // query-string updates the Need Help search makes while you type.
      withInMemoryScrolling({ scrollPositionRestoration: 'disabled', anchorScrolling: 'disabled' })
    )
  ]
};
