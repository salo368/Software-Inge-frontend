import { Observable, from } from 'rxjs';

/**
 * Uploads a browser `File`/`Blob` to an S3 presigned PUT URL.
 *
 * `headers` must be exactly the `upload_headers` the backend returned with the
 * URL: they are part of the signature, so a missing or different header makes
 * S3 answer `403 SignatureDoesNotMatch`. This goes through `fetch` instead of
 * HttpClient so the auth interceptor never attaches the bearer token to an S3
 * request.
 */
export function putToPresignedUrl(
  url: string,
  body: Blob,
  headers: Record<string, string>,
): Observable<void> {
  return from(
    fetch(url, { method: 'PUT', headers, body }).then((resp) => {
      if (!resp.ok) throw new Error(`S3 upload failed: ${resp.status}`);
    }),
  );
}
