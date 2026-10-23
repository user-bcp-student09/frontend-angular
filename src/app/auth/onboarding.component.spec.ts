// onboarding.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { OnboardingComponent } from './onboarding.component';

describe('OnboardingComponent', () => {
  let fixture: ComponentFixture<OnboardingComponent>;
  let component: OnboardingComponent;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnboardingComponent, HttpClientTestingModule]
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingComponent);
    component = fixture.componentInstance;
    httpTesting = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('bloquea OTP vacío sin llamar a la API y marca el campo inválido', () => {
    component.flowId = 'flow-test';
    component.stage = 'otp';

    component.verifyOtp();

    expect(component.otpForm.invalid).toBeTrue();
    expect(component.otpControl.touched).toBeTrue();
    httpTesting.expectNone('/api/onboarding/flows/flow-test/otp');
  });

  it('rechaza un código con formato inválido antes de llamar a la API', () => {
    component.flowId = 'flow-test';
    component.otpControl.setValue('12 456');

    component.verifyOtp();

    expect(component.otpForm.invalid).toBeTrue();
    httpTesting.expectNone('/api/onboarding/flows/flow-test/otp');
  });

  it('envía el OTP con formato válido al backend y avanza solo tras respuesta', () => {
    component.flowId = 'flow-test';
    component.stage = 'otp';
    component.otpControl.setValue('123456');

    component.verifyOtp();

    const request = httpTesting.expectOne('/api/onboarding/flows/flow-test/otp');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ code: '123456' });

    request.flush({
      flowId: 'flow-test',
      state: 'OTP_VERIFIED',
      currentStep: 'KYC_DATA',
      walletActive: false
    });

    expect(component.stage).toBe('kyc');
    expect(component.walletActive).toBeFalse();
  });

  it('rechaza documentos compuestos solo por espacios sin llamar a la API', () => {
    component.flowId = 'flow-test';
    component.stage = 'kyc';
    component.documentControl.setValue('     ');

    component.submitKyc();

    expect(component.kycForm.invalid).toBeTrue();
    expect(component.documentControl.touched).toBeTrue();
    httpTesting.expectNone('/api/onboarding/flows/flow-test/submit');
  });

  it('rechaza un formato de documento que no empieza con TEST-', () => {
    component.flowId = 'flow-test';
    component.documentControl.setValue('DOC-DEMO-001');

    component.submitKyc();

    expect(component.documentControl.hasError('testDocument')).toBeTrue();
    httpTesting.expectNone('/api/onboarding/flows/flow-test/submit');
  });

  it('rechaza TEST- sin un valor ficticio después del prefijo', () => {
    component.flowId = 'flow-test';
    component.documentControl.setValue('TEST-   ');

    component.submitKyc();

    expect(component.documentControl.invalid).toBeTrue();
    httpTesting.expectNone('/api/onboarding/flows/flow-test/submit');
  });

  it('envía los datos ficticios válidos con documentType TEST', () => {
    component.flowId = 'flow-test';
    component.stage = 'kyc';
    component.documentTypeControl.setValue('TEST');
    component.documentControl.setValue('TEST-DEMO-001');

    component.submitKyc();

    const request = httpTesting.expectOne('/api/onboarding/flows/flow-test/submit');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      documentType: 'TEST',
      document: 'TEST-DEMO-001'
    });

    request.flush({
      flowId: 'flow-test',
      state: 'ACTIVE',
      walletActive: true
    });

    expect(component.stage).toBe('result');
    expect(component.resultState).toBe('ACTIVE');
    expect(component.walletActive).toBeTrue();

    const reportRequest = httpTesting.expectOne('/api/onboarding/report');
    reportRequest.flush({
      medianOnboardingDurationMs: 120000,
      sampleSize: 2
    });

    expect(component.reportState).toBe('available');
  });

  it('mantiene el formulario y permite reintentar ante KYC_UNAVAILABLE', () => {
    component.flowId = 'flow-test';
    component.stage = 'kyc';
    component.documentControl.setValue('TEST-DEMO-001');

    component.submitKyc();

    const request = httpTesting.expectOne('/api/onboarding/flows/flow-test/submit');
    request.flush(
      { code: 'KYC_UNAVAILABLE' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(component.stage).toBe('kyc');
    expect(component.walletActive).toBeFalse();
    expect(component.documentControl.value).toBe('TEST-DEMO-001');
    expect(component.globalError).toContain('no está activa');

    component.globalError = '';
    component.submitKyc();

    const retry = httpTesting.expectOne('/api/onboarding/flows/flow-test/submit');
    expect(retry.request.method).toBe('POST');
    retry.flush({
      flowId: 'flow-test',
      state: 'PENDING',
      walletActive: false
    });

    expect(component.resultState).toBe('PENDING');
    expect(component.walletActive).toBeFalse();

    httpTesting.expectOne('/api/onboarding/report').flush({ sampleSize: 0 });
  });

  it('no emite solicitudes duplicadas mientras la primera sigue pendiente', () => {
    component.stage = 'intro';

    component.startFlow();
    component.startFlow();

    const requests = httpTesting.match('/api/onboarding/flows');
    expect(requests.length).toBe(1);
    requests[0].flush({
      flowId: 'flow-test',
      state: 'STARTED',
      currentStep: 'PHONE_OTP',
      walletActive: false
    });
  });

  it('asocia ayuda y error visibles al campo inválido', () => {
    component.stage = 'kyc';
    component.flowId = 'flow-test';
    fixture.detectChanges();

    component.submitKyc();
    fixture.detectChanges();

    const input: HTMLInputElement | null =
      fixture.nativeElement.querySelector('#test-document');
    const help = fixture.nativeElement.querySelector('#document-help');
    const error = fixture.nativeElement.querySelector('#document-error');

    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toContain('document-help');
    expect(input?.getAttribute('aria-describedby')).toContain('document-error');
    expect(help).not.toBeNull();
    expect(error?.textContent).toContain('identificador');
    httpTesting.expectNone('/api/onboarding/flows/flow-test/submit');
  });
});