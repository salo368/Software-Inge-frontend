import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';

import { environment } from '../environments/environment';
import { RequiredFileType } from './processes.service';
import { putToPresignedUrl } from './s3-upload';

/** Every user-uploadable `FileType` (backend libs/orm/files.py). */
export type UploadFileType = RequiredFileType | 'INVESTMENT_ORDER';

export const ALLOWED_FILE_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export interface UploadUrlResponse {
  upload_url: string;
  key: string;
  content_type: string;
  /** Must all go, verbatim, on the PUT: they are signed into the URL. */
  upload_headers: Record<string, string>;
  expires_in: number;
}

@Injectable({ providedIn: 'root' })
export class FilesService {
  private http = inject(HttpClient);
  private base = environment.filesApiUrl;

  /**
   * Presigned PUT straight to S3. The file is registered asynchronously by
   * the `on_upload` S3 trigger from the object metadata, so callers poll
   * `ProcessesService.requiredFiles()` to see it land.
   */
  upload(processId: string, fileType: UploadFileType, file: File): Observable<UploadUrlResponse> {
    return this.http
      .post<UploadUrlResponse>(`${this.base}/files/upload-url`, {
        process_id: processId,
        file_type: fileType,
        content_type: file.type || 'application/pdf',
        original_name: file.name,
      })
      .pipe(
        switchMap((r) =>
          putToPresignedUrl(r.upload_url, file, r.upload_headers ?? { 'Content-Type': r.content_type }).pipe(
            map(() => r),
          ),
        ),
      );
  }
}
