import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/landing.component').then(m => m.LandingComponent), title: 'Mission Men of Anna' },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login.component').then(m => m.LoginComponent), title: 'Sign in' },
  { path: 'signup', loadComponent: () => import('./pages/signup.component').then(m => m.SignupComponent), title: 'Join' },
  { path: 'verify', loadComponent: () => import('./pages/verify-email.component').then(m => m.VerifyEmailComponent), title: 'Verify email' },
  { path: 'verify-pending', loadComponent: () => import('./pages/verify-pending.component').then(m => m.VerifyPendingComponent), title: 'Check your email' },
  { path: 'forgot-password', loadComponent: () => import('./pages/forgot-password.component').then(m => m.ForgotPasswordComponent), title: 'Reset password' },
  { path: 'reset-password', loadComponent: () => import('./pages/reset-password.component').then(m => m.ResetPasswordComponent), title: 'Choose a new password' },
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./pages/dashboard.component').then(m => m.DashboardComponent), title: 'Member home' },
  { path: '**', redirectTo: '' }
];
