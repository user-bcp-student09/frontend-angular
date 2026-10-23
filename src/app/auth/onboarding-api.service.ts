// onboarding-api.service.ts
import { inject, Injectable, InjectionToken } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export const ONBOARDING_API_BASE_URL = new InjectionToken<string>(
  'ONBOARDING_API_BASE_URL',
  {
    providedIn: 'root',
    factory: () => '/api/onboarding'
  }
);

export interface OnboardingFlow {
  flowId: string;
  state: string;
  currentStep?: 'PHONE_OTP' | 'KYC_DATA' | 'RESULT';
  walletActive?: boolean;
}

export interface OnboardingReport {
  // Confirmar estos nombres con el DTO definitivo de GET /report.
  medianOnboardingDurationMs?: number | null;
  medianKycDurationMs?: number | null;
  medianActivationDurationMs?: number | null;
  sampleSize?: number;
}

@Injectable({ providedIn: 'root' })
export class OnboardingApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(ONBOARDING_API_BASE_URL);

  startFlow(): Observable<OnboardingFlow> {
    return this.http.post<OnboardingFlow>(`${this.baseUrl}/flows`, {});
  }

  verifyOtp(flowId: string, code: string): Observable<OnboardingFlow> {
    return this.http.post<OnboardingFlow>(
      `${this.flowUrl(flowId)}/otp`,
      { code }
    );
  }

  submitKyc(
    flowId: string,
    documentType: 'TEST',
    document: string
  ): Observable<OnboardingFlow> {
    return this.http.post<OnboardingFlow>(
      `${this.flowUrl(flowId)}/submit`,
      { documentType, document }
    );
  }

  getFlow(flowId: string): Observable<OnboardingFlow> {
    return this.http.get<OnboardingFlow>(this.flowUrl(flowId));
  }

  resolveDecision(
    flowId: string,
    decision: 'ACTIVE' | 'REJECTED'
  ): Observable<OnboardingFlow> {
    return this.http.post<OnboardingFlow>(
      `${this.flowUrl(flowId)}/decision`,
      { decision }
    );
  }

  closeFlow(flowId: string): Observable<unknown> {
    return this.http.post(`${this.flowUrl(flowId)}/close`, {});
  }

  getReport(): Observable<OnboardingReport> {
    return this.http.get<OnboardingReport>(`${this.baseUrl}/report`);
  }

  /**
   * Mejor esfuerzo para cerrar una pestaña. El backend debe aceptar el mismo
   * cuerpo vacío usado por closeFlow. No sustituye el cierre confirmado.
   */
  closeWithBeacon(flowId: string): boolean {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
      return false;
    }

    const body = new Blob(['{}'], { type: 'application/json' });
    return navigator.sendBeacon(
      `${this.flowUrl(flowId)}/close`,
      body
    );
  }

  private flowUrl(flowId: string): string {
    return `${this.baseUrl}/flows/${encodeURIComponent(flowId)}`;
  }
}