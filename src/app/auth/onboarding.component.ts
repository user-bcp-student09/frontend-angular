// onboarding.component.ts
import {
  Component,
  ElementRef,
  HostListener,
  ViewChild
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { OnboardingApiService, OnboardingFlow, OnboardingReport } from './onboarding-api.service';

type Stage = 'intro' | 'otp' | 'kyc' | 'result' | 'finished';
type ResultState =
  | 'ACTIVE'
  | 'PENDING'
  | 'REJECTED'
  | 'SUBMISSION_UNKNOWN'
  | 'CHECKING'
  | null;

type ReportState = 'idle' | 'loading' | 'available' | 'empty' | 'error';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss'
})
export class OnboardingComponent {
  @ViewChild('otpInput') otpInput?: ElementRef<HTMLInputElement>;
  @ViewChild('documentInput') documentInput?: ElementRef<HTMLInputElement>;

  readonly otpForm = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{6}$/)]
    })
  });

  readonly kycForm = new FormGroup({
    documentType: new FormControl('TEST', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    document: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        rejectWhitespaceOnly,
        testDocumentValidator
      ]
    })
  });

  stage: Stage = 'intro';
  flowId: string | null = null;
  flowState = '';
  resultState: ResultState = null;
  walletActive = false;

  requestInProgress = false;
  globalError = '';
  otpApiError = '';
  documentApiError = '';
  closeError = '';
  closeAttempted = false;

  reportState: ReportState = 'idle';
  report: OnboardingReport | null = null;

  otpAttempted = false;
  kycAttempted = false;
  finishedMessage = '';

  constructor(private readonly api: OnboardingApiService) {}

  get currentStep(): number {
    if (this.stage === 'kyc') return 2;
    if (this.stage === 'result' || this.stage === 'finished') return 3;
    return 1;
  }

  get otpControl(): FormControl<string> {
    return this.otpForm.controls.code;
  }

  get documentControl(): FormControl<string> {
    return this.kycForm.controls.document;
  }

  get documentTypeControl(): FormControl<string> {
    return this.kycForm.controls.documentType;
  }

  get showOtpError(): boolean {
    return (this.otpControl.touched || this.otpAttempted) &&
      this.otpControl.invalid;
  }

  get otpErrorText(): string {
    if (this.otpApiError) return this.otpApiError;
    if (this.otpControl.hasError('required')) {
      return 'Ingresa el código de demostración.';
    }
    if (this.otpControl.hasError('pattern')) {
      return 'El código debe tener exactamente seis dígitos.';
    }
    return 'Revisa el código e inténtalo de nuevo.';
  }

  get showDocumentError(): boolean {
    return (this.documentControl.touched || this.kycAttempted) &&
      this.documentControl.invalid;
  }

  get documentErrorText(): string {
    if (this.documentApiError) return this.documentApiError;
    if (this.documentControl.hasError('required')) {
      return 'Ingresa un identificador ficticio de prueba.';
    }
    if (this.documentControl.hasError('whitespaceOnly')) {
      return 'El dato no puede contener solo espacios. Ingresa un identificador de prueba.';
    }
    if (this.documentControl.hasError('testDocument')) {
      return 'Debe comenzar exactamente con TEST- y tener un valor ficticio después del guion.';
    }
    return 'Revisa el identificador ficticio.';
  }

  startFlow(): void {
    if (this.requestInProgress || this.flowId) return;

    this.resetMessages();
    this.requestInProgress = true;

    this.api.startFlow().subscribe({
      next: flow => {
        this.flowId = flow.flowId;
        this.flowState = flow.state;
        this.stage = 'otp';
        this.requestInProgress = false;
      },
      error: error => {
        this.globalError = this.messageForError(error, 'No pudimos iniciar el recorrido. Inténtalo nuevamente.');
        this.requestInProgress = false;
      }
    });
  }

  verifyOtp(): void {
    this.otpAttempted = true;
    this.otpForm.markAllAsTouched();
    this.otpApiError = '';

    if (this.otpForm.invalid || this.otpForm.pending) {
      this.focusFirstInvalid('otp');
      return;
    }
    if (!this.flowId || this.requestInProgress) return;

    this.resetMessages();
    this.requestInProgress = true;

    this.api.verifyOtp(this.flowId, this.otpControl.value).subscribe({
      next: flow => {
        this.flowState = flow.state;
        this.stage = 'kyc';
        this.requestInProgress = false;
      },
      error: error => {
        const code = this.errorCode(error);
        if (code === 'OTP_INVALID') {
          this.otpApiError = 'El código no coincide. Revisa el código de demostración e inténtalo de nuevo.';
          this.otpControl.setErrors({
            ...(this.otpControl.errors ?? {}),
            server: true
          });
        } else {
          this.globalError = this.messageForError(error, 'No pudimos validar el código. Inténtalo nuevamente.');
        }
        this.requestInProgress = false;
      }
    });
  }

  clearOtpServerError(): void {
    this.otpApiError = '';
    const errors = this.otpControl.errors;
    if (!errors?.['server']) return;

    const { server: _server, ...remaining } = errors;
    this.otpControl.setErrors(Object.keys(remaining).length ? remaining : null);
  }

  submitKyc(): void {
    this.kycAttempted = true;
    this.kycForm.markAllAsTouched();
    this.documentApiError = '';

    if (this.kycForm.invalid || this.kycForm.pending) {
      this.focusFirstInvalid('kyc');
      return;
    }
    if (!this.flowId || this.requestInProgress) return;

    this.resetMessages();
    this.requestInProgress = true;
    const document = this.documentControl.value.trim();

    this.api.submitKyc(this.flowId, 'TEST', document).subscribe({
      next: flow => {
        this.requestInProgress = false;
        this.applyFlowResult(flow);
      },
      error: error => {
        const code = this.errorCode(error);
        this.requestInProgress = false;

        if (code === 'TEST_DOCUMENT_REQUIRED' || code === 'TEST_DOCUMENT_INVALID') {
          this.documentApiError = code === 'TEST_DOCUMENT_REQUIRED'
            ? 'Ingresa un identificador ficticio de prueba.'
            : 'El identificador debe comenzar con TEST- y tener un valor ficticio después del guion.';
          this.documentControl.setErrors({
            ...(this.documentControl.errors ?? {}),
            server: true
          });
        } else if (code === 'KYC_UNAVAILABLE' || this.statusCode(error) === 503) {
          this.stage = 'kyc';
          this.globalError = 'No pudimos completar la verificación de demo. Tu wallet no está activa. Puedes reintentar.';
        } else if (code === 'SUBMISSION_UNKNOWN') {
          this.stage = 'result';
          this.resultState = 'SUBMISSION_UNKNOWN';
          this.walletActive = false;
          this.flowState = 'SUBMISSION_UNKNOWN';
        } else {
          this.globalError = this.messageForError(error, 'No pudimos enviar los datos de prueba. Revisa el dato e inténtalo nuevamente.');
        }
      }
    });
  }

  resolveDecision(decision: 'ACTIVE' | 'REJECTED'): void {
    if (!this.flowId || this.requestInProgress || this.resultState !== 'PENDING') return;

    this.resetMessages();
    this.requestInProgress = true;
    this.api.resolveDecision(this.flowId, decision).subscribe({
      next: flow => {
        this.requestInProgress = false;
        this.applyFlowResult(flow);
      },
      error: error => {
        this.globalError = this.messageForError(error, 'No pudimos confirmar la decisión de demo. El estado sigue sin cambiar.');
        this.requestInProgress = false;
      }
    });
  }

  refreshStatus(): void {
    if (!this.flowId || this.requestInProgress) return;

    this.resetMessages();
    this.requestInProgress = true;
    this.api.getFlow(this.flowId).subscribe({
      next: flow => {
        this.requestInProgress = false;
        this.applyFlowResult(flow);
      },
      error: error => {
        this.globalError = this.messageForError(error, 'No pudimos consultar el estado. Inténtalo nuevamente.');
        this.requestInProgress = false;
      }
    });
  }

  finishFlow(): void {
    if (!this.flowId || this.requestInProgress || this.closeAttempted) return;

    this.closeAttempted = true;
    this.closeError = '';
    this.requestInProgress = true;
    this.api.closeFlow(this.flowId).subscribe({
      next: () => {
        this.requestInProgress = false;
        this.stage = 'finished';
        this.finishedMessage = 'El cierre del recorrido fue confirmado.';
      },
      error: () => {
        this.requestInProgress = false;
        this.closeError = 'No pudimos confirmar el cierre. Puedes salir, pero no afirmaremos que quedó registrado.';
      }
    });
  }

  leaveWithoutConfirmedClose(): void {
    this.stage = 'finished';
    this.finishedMessage = 'Saliste sin confirmación del cierre del recorrido.';
  }

  @HostListener('window:pagehide')
  onPageHide(): void {
    if (this.flowId && !this.closeAttempted && this.stage !== 'finished') {
      this.closeAttempted = true;
      this.api.closeWithBeacon(this.flowId);
    }
  }

  stepStatus(step: number): 'current' | 'complete' | 'upcoming' {
    if (step < this.currentStep) return 'complete';
    if (step === this.currentStep) return 'current';
    return 'upcoming';
  }

  formatDuration(milliseconds?: number | null): string {
    if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) {
      return 'No disponible';
    }
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
  }

  private applyFlowResult(flow: OnboardingFlow): void {
    this.flowState = flow.state;
    this.stage = 'result';

    switch (flow.state) {
      case 'ACTIVE':
        this.resultState = 'ACTIVE';
        this.walletActive = flow.walletActive === true || flow.state === 'ACTIVE';
        break;
      case 'PENDING':
        this.resultState = 'PENDING';
        this.walletActive = false;
        break;
      case 'REJECTED':
        this.resultState = 'REJECTED';
        this.walletActive = false;
        break;
      case 'SUBMISSION_UNKNOWN':
        this.resultState = 'SUBMISSION_UNKNOWN';
        this.walletActive = false;
        break;
      default:
        this.resultState = 'CHECKING';
        this.walletActive = false;
        break;
    }

    this.loadReport();
  }

  private loadReport(): void {
    this.reportState = 'loading';
    this.report = null;
    this.api.getReport().subscribe({
      next: report => {
        this.report = report;
        this.reportState = (report.sampleSize ?? 0) > 0 ? 'available' : 'empty';
      },
      error: () => {
        this.reportState = 'error';
      }
    });
  }

  private focusFirstInvalid(form: 'otp' | 'kyc'): void {
    setTimeout(() => {
      if (form === 'otp') {
        this.otpInput?.nativeElement.focus();
      } else {
        this.documentInput?.nativeElement.focus();
      }
    });
  }

  private resetMessages(): void {
    this.globalError = '';
    this.closeError = '';
  }

  private errorCode(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return '';
    const body = error.error as { code?: string; error?: string } | null;
    return body?.code ?? body?.error ?? '';
  }

  private statusCode(error: unknown): number {
    return error instanceof HttpErrorResponse ? error.status : 0;
  }

  private messageForError(error: unknown, fallback: string): string {
    const code = this.errorCode(error);
    const safeMessages: Record<string, string> = {
      INVALID_STATE: 'No se puede avanzar desde este estado. Consulta el estado del recorrido.',
      OTP_INVALID: 'El código no coincide. Revisa el código de demostración.',
      TEST_DOCUMENT_REQUIRED: 'Ingresa un identificador ficticio de prueba.',
      TEST_DOCUMENT_INVALID: 'El identificador debe comenzar con TEST- y tener contenido ficticio después del guion.',
      KYC_UNAVAILABLE: 'La verificación de demo no está disponible por ahora. Tu wallet no está activa.'
    };
    return safeMessages[code] ?? fallback;
  }
}

function rejectWhitespaceOnly(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.trim().length === 0 ? { whitespaceOnly: true } : null;
}

function testDocumentValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const normalized = value.trim();
  return normalized.startsWith('TEST-') && normalized.length > 'TEST-'.length
    ? null
    : { testDocument: true };
}