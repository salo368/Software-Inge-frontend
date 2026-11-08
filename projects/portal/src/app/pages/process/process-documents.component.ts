import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';

import { ALLOWED_FILE_CONTENT_TYPES, FilesService } from '@shared/core/files.service';
import { ProcessesService, RequiredFileType, RequiredFiles } from '@shared/core/processes.service';

const POLL_MS = 2000;
const MAX_POLL = 20;
const MAX_BYTES = 10 * 1024 * 1024;

interface DocDef {
  type: RequiredFileType;
  /** DOM id fragment (`process-documents-*-<slug>`). */
  slug: string;
  label: string;
  hint: string;
  icon: string;
}

/** Display order. Which ones apply comes from the backend. */
const DOCS: DocDef[] = [
  {
    type: 'BANK_CERT',
    slug: 'bank-cert',
    label: 'Certificacion bancaria',
    hint: 'De la cuenta desde la que vas a transferir. Expedida hace menos de 30 dias.',
    icon: 'bi-bank',
  },
  {
    type: 'TAX_DECLARATION',
    slug: 'tax-declaration',
    label: 'Declaracion de renta',
    hint: 'Ultimo periodo disponible. Te la pedimos porque eres declarante.',
    icon: 'bi-file-earmark-text',
  },
  {
    type: 'RUT',
    slug: 'rut',
    label: 'RUT',
    hint: 'Registro Unico Tributario actualizado. Te lo pedimos por ser PEP.',
    icon: 'bi-file-earmark-person',
  },
];

export interface DocRow extends DocDef {
  uploaded: boolean;
  uploading: boolean;
  /** Original file name of the last upload done in this session. */
  fileName: string | null;
  error: string | null;
}

/**
 * Upload of the documents the process requires (`BANK_CERT` always,
 * `TAX_DECLARATION` for tax declarants, `RUT` for PEPs). The file goes
 * straight to S3; the backend registers it asynchronously, so after each
 * upload we poll `get-required-files` until that type flips to `true`.
 *
 * Emits `completeChange` with whether every required document is in.
 */
@Component({
  selector: 'app-process-documents',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './process-documents.component.html',
})
export class ProcessDocumentsComponent implements OnInit, OnDestroy {
  @Input({ required: true }) processId!: string;
  @Output() completeChange = new EventEmitter<boolean>();

  private filesApi = inject(FilesService);
  private processesApi = inject(ProcessesService);
  private pollTimer: number | null = null;
  private attempts = 0;

  readonly ACCEPT = ALLOWED_FILE_CONTENT_TYPES.join(',');

  loading = signal(true);
  loadError = signal<string | null>(null);
  rows = signal<DocRow[]>([]);

  readonly complete = computed(() => {
    const r = this.rows();
    return r.length > 0 && r.every((d) => d.uploaded);
  });
  readonly anyUploading = computed(() => this.rows().some((d) => d.uploading));

  ngOnInit(): void {
    this.refresh(true);
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  /** Re-reads the requirement map (public so the parent can call it after a form edit). */
  refresh(initial = false): void {
    this.processesApi.requiredFiles(this.processId).subscribe({
      next: (status) => {
        this.apply(status);
        if (initial) this.loading.set(false);
      },
      error: () => {
        if (initial) {
          this.loading.set(false);
          this.loadError.set('No pudimos consultar tus documentos. Recarga la pagina.');
        }
      },
    });
  }

  private apply(status: RequiredFiles): void {
    const prev = new Map(this.rows().map((r) => [r.type, r]));
    const next: DocRow[] = DOCS.filter((d) => d.type in status).map((d) => {
      const p = prev.get(d.type);
      const uploaded = status[d.type] === true;
      return {
        ...d,
        uploaded,
        uploading: uploaded ? false : (p?.uploading ?? false),
        fileName: p?.fileName ?? null,
        error: uploaded ? null : (p?.error ?? null),
      };
    });
    const wasComplete = this.complete();
    this.rows.set(next);
    if (!this.anyUploading()) this.clearTimer();
    if (this.complete() !== wasComplete) this.completeChange.emit(this.complete());
  }

  onFileChange(row: DocRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.upload(row.type, file);
  }

  upload(type: RequiredFileType, file: File): void {
    const row = this.rows().find((r) => r.type === type);
    if (!row || row.uploading) return;

    if (file.type && !(ALLOWED_FILE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      this.patch(type, { error: 'Formato no admitido. Sube un PDF, JPG o PNG.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      this.patch(type, { error: 'El archivo supera 10 MB.' });
      return;
    }

    this.patch(type, { uploading: true, error: null, fileName: file.name });
    this.filesApi.upload(this.processId, type, file).subscribe({
      next: () => this.startPolling(),
      error: () =>
        this.patch(type, {
          uploading: false,
          error: 'No pudimos subir el archivo. Verifica el formato e intenta de nuevo.',
        }),
    });
  }

  private patch(type: RequiredFileType, changes: Partial<DocRow>): void {
    this.rows.update((rows) => rows.map((r) => (r.type === type ? { ...r, ...changes } : r)));
  }

  private startPolling(): void {
    this.attempts = 0;
    if (this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(() => {
      this.attempts += 1;
      if (this.attempts > MAX_POLL) {
        this.clearTimer();
        this.rows.update((rows) =>
          rows.map((r) =>
            r.uploading
              ? {
                  ...r,
                  uploading: false,
                  error: 'El archivo se subio pero tarda en registrarse. Recarga la pagina en unos segundos.',
                }
              : r,
          ),
        );
        return;
      }
      this.refresh();
    }, POLL_MS);
  }

  private clearTimer(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
