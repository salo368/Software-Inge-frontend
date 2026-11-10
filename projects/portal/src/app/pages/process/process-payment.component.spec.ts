import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProcessPaymentComponent } from './process-payment.component';

describe('ProcessPaymentComponent · monto', () => {
  let fixture: ComponentFixture<ProcessPaymentComponent>;
  let component: ProcessPaymentComponent;
  let http: HttpTestingController;

  const input = () => fixture.nativeElement.querySelector('#process-payment-amount') as HTMLInputElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ProcessPaymentComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProcessPaymentComponent);
    component = fixture.componentInstance;
    component.processId = 'p-1';
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/processes/get-pending-pay'))
      .flush({ amount: 56000000, paid: 0, pending: 56000000 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('precarga lo que falta con puntos de miles y sin ceros a la izquierda', () => {
    expect(input().value).toBe('56.000.000');
    expect(component.amount).toBe(56000000);
  });

  it('al escribir agrupa miles, quita ceros a la izquierda y guarda el numero limpio', () => {
    input().value = '000120000';
    input().dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '0' }));
    fixture.detectChanges();

    expect(input().value).toBe('120.000');
    expect(component.amount).toBe(120000);
  });

  it('vacio deja el monto en null y no se puede registrar', () => {
    input().value = '';
    input().dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }));
    fixture.detectChanges();

    expect(component.amount).toBeNull();
    expect(component.canSubmit()).toBeFalse();
  });

  it('no deja registrar un monto mayor a lo que falta y lo marca como invalido', () => {
    component.receipt = new File(['x'], 'c.pdf', { type: 'application/pdf' });
    input().value = '56000001';
    input().dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '1' }));
    fixture.detectChanges();

    expect(component.amount).toBe(56000001);
    expect(component.exceedsPending()).toBeTrue();
    expect(component.canSubmit()).toBeFalse();
    expect(input().classList).toContain('is-invalid');
    expect(fixture.nativeElement.querySelector('#process-payment-amount-hint').textContent).toContain('No puede superar');
  });

  it('un pago parcial es valido y "Pagar todo" vuelve al saldo completo', async () => {
    component.receipt = new File(['x'], 'c.pdf', { type: 'application/pdf' });
    input().value = '20000000';
    input().dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '0' }));
    fixture.detectChanges();

    expect(component.exceedsPending()).toBeFalse();
    expect(component.canSubmit()).toBeTrue();

    (fixture.nativeElement.querySelector('#process-payment-pay-all') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable(); // ngModel writes the view on a microtask

    expect(component.amount).toBe(56000000);
    expect(input().value).toBe('56.000.000');
  });
});
