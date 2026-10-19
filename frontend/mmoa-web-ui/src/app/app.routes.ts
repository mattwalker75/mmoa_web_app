import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home.component').then(m => m.HomeComponent), title: 'Mission Men of Anna' },
  { path: 'events', loadComponent: () => import('./pages/events.component').then(m => m.EventsComponent), title: 'Events · Mission Men of Anna' },
  { path: 'events/:slug', loadComponent: () => import('./pages/event-detail.component').then(m => m.EventDetailComponent), title: 'Event · Mission Men of Anna' },
  { path: 'raffles', loadComponent: () => import('./pages/raffles.component').then(m => m.RafflesComponent), title: 'Raffles · Mission Men of Anna' },
  { path: 'raffles/:slug', loadComponent: () => import('./pages/raffle-detail.component').then(m => m.RaffleDetailComponent), title: 'Raffle · Mission Men of Anna' },
  { path: 'need-help', loadComponent: () => import('./pages/need-help.component').then(m => m.NeedHelpComponent), title: 'Need Help? · Mission Men of Anna' },
  { path: 'need-help/org/:id', loadComponent: () => import('./pages/org-profile.component').then(m => m.OrgProfileComponent), title: 'Need Help? · Mission Men of Anna' },
  { path: 'about', loadComponent: () => import('./pages/about.component').then(m => m.AboutComponent), title: 'About · Mission Men of Anna' },
  { path: 'partner', loadComponent: () => import('./pages/partner.component').then(m => m.PartnerComponent), title: 'Partner With Us · Mission Men of Anna' },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login.component').then(m => m.LoginComponent), title: 'Nonprofit login · Mission Men of Anna' },
  { path: 'signup', loadComponent: () => import('./pages/signup.component').then(m => m.SignupComponent), title: 'Create a nonprofit login · Mission Men of Anna' },
  { path: 'verify', loadComponent: () => import('./pages/verify-email.component').then(m => m.VerifyEmailComponent), title: 'Verify email · Mission Men of Anna' },
  { path: 'verify-pending', loadComponent: () => import('./pages/verify-pending.component').then(m => m.VerifyPendingComponent), title: 'Check your email · Mission Men of Anna' },
  { path: 'forgot-password', loadComponent: () => import('./pages/forgot-password.component').then(m => m.ForgotPasswordComponent), title: 'Reset password · Mission Men of Anna' },
  { path: 'reset-password', loadComponent: () => import('./pages/reset-password.component').then(m => m.ResetPasswordComponent), title: 'Choose a new password · Mission Men of Anna' },
  { path: 'portal', canActivate: [authGuard], loadComponent: () => import('./pages/portal.component').then(m => m.PortalComponent), title: 'My profile · Mission Men of Anna' },
  // v1 member home → the nonprofit portal.
  { path: 'dashboard', redirectTo: 'portal' },
  { path: '**', loadComponent: () => import('./pages/not-found.component').then(m => m.NotFoundComponent), title: 'Page not found · Mission Men of Anna' }
];
