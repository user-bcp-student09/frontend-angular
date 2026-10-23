import { Routes } from '@angular/router';
import { OnboardingComponent } from './auth/onboarding.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: OnboardingComponent },
  { path: '**', redirectTo: '' }
];
