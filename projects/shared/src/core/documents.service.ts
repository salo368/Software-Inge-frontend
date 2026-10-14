import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * Cliente del servicio `documents` (C11, "Capturar y validar documentación
 * de soporte"). Patrón Facade: oculta la complejidad de pedir una URL
 * presignada + hacer PUT directo a S3 detrás de un método simple
 * `upload()` -- mismo patrón que FilesService, pero como archivo
 * independiente porque `documents` es un backend separado de `files`
 * (ver C11_Arquitectura_Mecanismos_y_Patrones.md §4).
 *
 * Slice básico (FB): solo `id_front` es un tipo de documento válido. FA2
 * (documentación corporativa) agrega más tipos en un slice siguiente.
 */
export type DocumentType = 'id_front';

export type DocumentStage = 'pendiente' | 'validando' | 'validado' | 'rechazado';

export interface DocumentStatusRow {
  id: string;
  document_type: DocumentType | string;
  stage: DocumentStage;
  rejection_reason: string | null;
  hash_sha256: string | null;
  uploaded_at: string;
  validated_at: string | null;
}

interface UploadUrlResponse {
  upload_url: string;
  key: string;
  content_type: string;
}

interface StatusResponse {
  process_id: string;
  documentos: DocumentStatusRow[];
}

export interface ReuseCandidate {
  id: string;
  document_type: DocumentType | string;
  validated_at: string;
  hash_sha256: string;
}

interface CheckReuseResponse {
  reutilizable: boolean;
  documento?: ReuseCandidate;
}

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private http = inject(HttpClient);
  private base = environment.documentsApiUrl;

  /**
   * Pide una URL firmada y sube el archivo directo a S3 (Presigned URL /
   * Direct-to-Storage Upload). El worker asíncrono del backend
   * (`on_upload`) hace el resto -- ver `status()` para el resultado.
   */
  upload(processId: string, documentType: DocumentType, file: File): Observable<UploadUrlResponse> {
    const req$ = this.http.post<UploadUrlResponse>(`${this.base}/documents/upload-url`, {
      process_id: processId,
      document_type: documentType,
      content_type: file.type || 'application/octet-stream',
    });

    return req$.pipe(
      switchMap((r) =>
        from(
          fetch(r.upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': r.content_type },
            body: file,
          }).then((resp) => {
            if (!resp.ok) throw new Error(`S3 upload failed: ${resp.status}`);
            return r;
          }),
        ),
      ),
    );
  }

  /** Consulta el estado del expediente documental (para el polling). */
  status(processId: string): Observable<StatusResponse> {
    return this.http.get<StatusResponse>(`${this.base}/documents/status`, {
      params: { process_id: processId },
    });
  }

  /**
   * FA1 (reutilización de vigentes): ¿el inversionista ya tiene, de un
   * proceso anterior, un documento de este tipo todavía vigente? Se llama
   * antes de mostrar el selector de archivo, para ofrecer reutilizar en
   * vez de forzar una nueva carga.
   */
  checkReuse(processId: string, documentType: DocumentType): Observable<CheckReuseResponse> {
    return this.http.get<CheckReuseResponse>(`${this.base}/documents/check-reuse`, {
      params: { process_id: processId, document_type: documentType },
    });
  }

  /** FA1: confirma la reutilización ofrecida por checkReuse(). */
  confirmReuse(
    processId: string,
    documentType: DocumentType,
    sourceDocumentId: string,
  ): Observable<DocumentStatusRow> {
    return this.http.post<DocumentStatusRow>(`${this.base}/documents/confirm-reuse`, {
      process_id: processId,
      document_type: documentType,
      source_document_id: sourceDocumentId,
    });
  }
}
