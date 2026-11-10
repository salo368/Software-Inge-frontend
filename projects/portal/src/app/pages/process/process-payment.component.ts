import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { formatCOP } from '@shared/core/format';
import { MoneyInputDirective } from '@shared/core/money-input.directive';
import { ALLOWED_RECEIPT_CONTENT_TYPES, PaymentsService } from '@shared/core/payments.service';
import { PendingPay, ProcessStage, ProcessesService } from '@shared/core/processes.service';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Funding step. The user transfers the money by their own means and then
 * reports each transfer with its receipt. Several partial payments are
 * allowed; `get-pending-pay` moves the process to `REVIEW` as soon as the
 * sum covers the amount, and we tell the parent through `stageChange`.
 */
@Component({
  selector: 'app-process-payment',
  standalone: true,
  imports: [CommonModule, FormsModule, MoneyInputDirective],
  templateUrl: './process-payment.component.html',
})
export class ProcessPaymentComponent implements OnInit {
  @Input({ required: true }) processId!: string;
  @Input() bankName: string | null = null;
  @Output() stageChange = new EventEmitter<ProcessStage>();

  private paymentsApi = inject(PaymentsService);
  private processesApi = inject(ProcessesService);

  readonly formatCOP = formatCOP;
  readonly ACCEPT = ALLOWED_RECEIPT_CONTENT_TYPES.join(',');

  loading = signal(true);
  submitting = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  pending = signal<PendingPay | null>(null);

  amount: number | null = null;
  receipt: File | null = null;

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    this.processesApi.pendingPay(this.processId).subscribe({
      next: (p) => {
        this.pending.set(p);
        this.loading.set(false);
        if (this.amount === null || this.amount > p.pending) this.amount = p.pending || null;
        if (p.stage !== 'PAYMENT') this.stageChange.emit(p.stage);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        if (err.error?.error === 'process_not_in_payment_stage') {
          // Someone else (another tab) already completed it: let the parent reload.
          this.stageChange.emit('REVIEW');
          return;
        }
        this.error.set('No pudimos consultar el estado de tu pago. Recarga la pagina.');
      },
    });
  }

  onReceipt(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.error.set(null);
    if (file && file.type && !(ALLOWED_RECEIPT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      this.receipt = null;
      input.value = '';
      this.error.set('Formato no admitido. Sube un PDF, JPG o PNG.');
      return;
    }
    if (file && file.size > MAX_BYTES) {
      this.receipt = null;
      input.value = '';
      this.error.set('El comprobante supera 10 MB.');
      return;
    }
    this.receipt = file;
  }

  /** The backend rejects a transfer above what is still owed (`amount_exceeds_pending`). */
  exceedsPending(): boolean {
    const p = this.pending();
    return !!p && this.amount !== null && this.amount > p.pending;
  }

  /** Fills the field with everything that is still owed. */
  payAll(): void {
    const p = this.pending();
    if (p) this.amount = p.pending || null;
  }

  canSubmit(): boolean {
    return (
      !!this.receipt && !!this.amount && this.amount > 0 && !this.exceedsPending() && !this.submitting()
    );
  }

  submit(): void {
    if (!this.canSubmit() || !this.receipt || !this.amount) return;
    const amount = this.amount;
    this.submitting.set(true);
    this.error.set(null);
    this.success.set(null);
    this.paymentsApi.register(this.processId, amount, this.receipt).subscribe({
      next: () => {
        this.submitting.set(false);
        this.receipt = null;
        this.amount = null;
        this.success.set(`Registramos tu pago de ${formatCOP(amount)}.`);
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(friendlyPaymentError(err?.error?.error));
        // Someone else paid in the meantime: refresh what is still owed.
        if (err?.error?.error === 'amount_exceeds_pending') this.reload();
      },
    });
  }
}

function friendlyPaymentError(code: string | undefined): string {
  switch (code) {
    case 'invalid_amount':
      return 'Ingresa un monto mayor a cero.';
    case 'amount_exceeds_pending':
      return 'El monto supera lo que te falta por pagar. Revisa el valor e intenta de nuevo.';
    case 'process_not_in_payment_stage':
      return 'Este proceso ya no esta esperando pagos. Recarga la pagina.';
    case 'processes_unavailable':
      return 'No pudimos validar tu proceso. Intenta de nuevo en unos segundos.';
    default:
      return 'No pudimos registrar el pago. Verifica el comprobante e intenta de nuevo.';
  }
}
