import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  inject,
  signal,
} from '@angular/core';

import { DocumentStatusRow, DocumentsService, ReuseCandidate } from '@shared/core/documents.service';
import { FileRow, FilesService } from '@shared/core/files.service';

const POLL_MS = 2000;
const MAX_POLL = 15;

@Component({
  selector: 'app-process-documents',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './process-documents.component.html',
})
export class ProcessDocumentsComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) processId!: string;
  @Input() files: FileRow[] = [];
  @Output() uploaded = new EventEmitter<void>();

  private api = inject(FilesService);
  private pollTimer: number | null = null;
  private attempts = 0;

  uploading = signal(false);
  progressMsg = signal('');
  error = signal<string | null>(null);

  get declaracion(): FileRow | undefined {
    return this.files.find((f) => f.file_type === 'declaracion_renta');
  }

  // --------------------------------------------------------------------
  // C11 -- Capturar y validar documentación de soporte (cédula, frente).
  // Backend y bucket propios (`documents`), separados de `files` -- por
  // eso este bloque mantiene su propio polling, independiente del de
  // `declaracion_renta` de arriba. Ver C11_Arquitectura_Mecanismos_y_
  // Patrones.md §5 para el flujo completo.
  // --------------------------------------------------------------------
  private documentsApi = inject(DocumentsService);
  private pollTimerId: number | null = null;
  private attemptsId = 0;

  uploadingId = signal(false);
  progressMsgId = signal('');
  errorId = signal<string | null>(null);
  idFrontEstado = signal<DocumentStatusRow | null>(null);

  // FA1 (reutilización de vigentes): si el inversionista ya tiene, de un
  // proceso anterior, un id_front validado y todavía vigente, se ofrece
  // reutilizarlo en vez de forzar una carga nueva. `reuseChecked` evita
  // repetir la consulta en cada ngOnChanges -- solo importa la primera vez
  // que processId está disponible y todavía no hay nada cargado aquí.
  reuseCandidate = signal<ReuseCandidate | null>(null);
  reusingId = signal(false);
  private reuseChecked = false;

  // The parent refreshes asynchronously after each `uploaded` emit, so the
  // registered row shows up here as a new `files` array rather than inline.
  ngOnChanges(): void {
    if (this.uploading() && this.declaracion) this.stopPolling('');
    if (this.processId && !this.reuseChecked && !this.idFrontEstado()) {
      this.reuseChecked = true;
      this.checkIdFrontReuse();
    }
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.clearTimerId();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadFile(file);
    input.value = '';
  }

  uploadFile(file: File): void {
    if (this.uploading()) return;
    this.uploading.set(true);
    this.error.set(null);
    this.progressMsg.set('Subiendo...');
    this.api.upload(this.processId, 'declaracion_renta', file).subscribe({
      next: () => {
        this.progressMsg.set('Registrando el documento...');
        this.startPolling();
      },
      error: () => {
        this.uploading.set(false);
        this.progressMsg.set('');
        this.error.set('No pudimos subir el archivo. Verifica el formato e intenta de nuevo.');
      },
    });
  }

  private startPolling(): void {
    this.attempts = 0;
    this.clearTimer();
    this.uploaded.emit();
    this.pollTimer = window.setInterval(() => {
      this.attempts += 1;
      if (this.attempts >= MAX_POLL) {
        this.stopPolling(
          'El archivo se subio pero tarda en registrarse. Recarga la pagina en unos segundos.',
        );
        return;
      }
      this.uploaded.emit();
    }, POLL_MS);
  }

  private stopPolling(errorMsg: string): void {
    this.clearTimer();
    this.uploading.set(false);
    this.progressMsg.set('');
    if (errorMsg) this.error.set(errorMsg);
  }

  private clearTimer(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  openFile(): void {
    const f = this.declaracion;
    if (!f) return;
    this.api.downloadUrl(f.id).subscribe({
      next: (r) => window.open(r.download_url, '_blank'),
    });
  }

  // --------------------------------------------------------------------
  // C11 -- cédula (frente). Mismo patrón de carga + polling que arriba,
  // pero consultando el estado de VALIDACIÓN (no solo "¿se subió?") --
  // por eso usa su propio DocumentsService.status(), no FilesService.
  // --------------------------------------------------------------------
  onIdFrontFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadIdFront(file);
    input.value = '';
  }

  uploadIdFront(file: File): void {
    if (this.uploadingId()) return;
    this.reuseCandidate.set(null);
    this.uploadingId.set(true);
    this.errorId.set(null);
    this.progressMsgId.set('Subiendo...');
    this.documentsApi.upload(this.processId, 'id_front', file).subscribe({
      next: () => {
        this.progressMsgId.set('Validando el documento...');
        this.startPollingId();
      },
      error: () => {
        this.uploadingId.set(false);
        this.progressMsgId.set('');
        this.errorId.set('No pudimos subir el archivo. Verifica el formato e intenta de nuevo.');
      },
    });
  }

  private startPollingId(): void {
    this.attemptsId = 0;
    this.clearTimerId();
    this.refreshIdStatus();
    this.pollTimerId = window.setInterval(() => {
      this.attemptsId += 1;
      if (this.attemptsId >= MAX_POLL) {
        this.clearTimerId();
        this.uploadingId.set(false);
        this.progressMsgId.set('');
        this.errorId.set('La validación está tardando. Recarga la página en unos segundos.');
        return;
      }
      this.refreshIdStatus();
    }, POLL_MS);
  }

  private refreshIdStatus(): void {
    this.documentsApi.status(this.processId).subscribe({
      next: (r) => {
        const doc = r.documentos.find((d) => d.document_type === 'id_front') ?? null;
        this.idFrontEstado.set(doc);
        if (doc && (doc.stage === 'validado' || doc.stage === 'rechazado')) {
          this.clearTimerId();
          this.uploadingId.set(false);
          this.progressMsgId.set('');
          if (doc.stage === 'rechazado') {
            this.errorId.set(this.mensajeRechazoId(doc.rejection_reason));
          }
        }
      },
      // Un fallo de red puntual durante el polling no debe matar el
      // ciclo -- se reintenta en el próximo tick hasta MAX_POLL.
      error: () => undefined,
    });
  }

  private mensajeRechazoId(reason: string | null): string {
    if (reason === 'documento_ilegible') {
      return 'No pudimos leer la imagen. Intenta con mejor luz o enfoque.';
    }
    if (reason === 'no_corresponde') {
      return 'El documento no corresponde con tus datos registrados.';
    }
    if (reason === 'formato_no_admitido') {
      return 'El archivo no es una imagen válida (JPEG o PNG). Verifica el formato e intenta de nuevo.';
    }
    return 'El documento fue rechazado. Intenta de nuevo.';
  }

  // --------------------------------------------------------------------
  // FA1 -- reutilización de un id_front vigente de un proceso anterior.
  // --------------------------------------------------------------------
  private checkIdFrontReuse(): void {
    this.documentsApi.checkReuse(this.processId, 'id_front').subscribe({
      next: (r) => this.reuseCandidate.set(r.reutilizable ? r.documento ?? null : null),
      // Si la consulta falla, se degrada en silencio al flujo normal de
      // carga -- no es un error que deba bloquear ni mostrarse.
      error: () => this.reuseCandidate.set(null),
    });
  }

  confirmIdFrontReuse(): void {
    const candidato = this.reuseCandidate();
    if (!candidato || this.reusingId()) return;
    this.reusingId.set(true);
    this.errorId.set(null);
    this.documentsApi.confirmReuse(this.processId, 'id_front', candidato.id).subscribe({
      next: (doc) => {
        this.reusingId.set(false);
        this.reuseCandidate.set(null);
        this.idFrontEstado.set(doc);
      },
      error: () => {
        this.reusingId.set(false);
        this.errorId.set('No pudimos reutilizar el documento anterior. Carga uno nuevo.');
        this.reuseCandidate.set(null);
      },
    });
  }

  declineIdFrontReuse(): void {
    this.reuseCandidate.set(null);
  }

  private clearTimerId(): void {
    if (this.pollTimerId !== null) {
      window.clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }
}
