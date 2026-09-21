/**
 * The signing SPA can be reached two ways:
 *
 *   A. Async: the backend emails a link (`/sign/{sign_id}`) after
 *      `processes/advance` opens the ceremony. The user clicks it,
 *      often on a different device (mobile) than the one that started
 *      the process (desktop). We have no session, no referrer, and no
 *      idea what to do after signing beyond a friendly "done" screen.
 *
 *   B. Sync: the portal redirects same-tab or opens a new tab pointing
 *      at `/sign/{sign_id}?return_url={encodeURIComponent(process_url)}`.
 *      When the ceremony finishes we should send the user back to that
 *      URL so they can continue the process.
 *
 * Path A is the harder constraint (no context), so `return_url` is
 * optional. Callers of `resolveReturnUrl()` render a generic completion
 * screen when it returns null.
 *
 * SECURITY: we require the return URL to be absolute AND to share the
 * same origin as the current window. Otherwise a phishing site could
 * embed `?return_url=https://evil.com/steal` in the email footer and
 * redirect the signer post-ceremony. Origin comparison against
 * `window.location` is the standard defense for post-message-style
 * flows and is enough here because the portal is served from the same
 * CloudFront distribution.
 */

/** Query-param key the portal is expected to use. */
export const RETURN_URL_QUERY_PARAM = 'return_url';

/** Label rendered on the "return to portal" CTA when we have a return URL. */
export const HOST_RETURN_LABEL = 'Volver al proceso';

/** Label rendered on the completion screen when we DON'T have one. */
export const HOST_STANDALONE_DONE_LABEL = 'Podés cerrar esta pestaña';

/**
 * Validate and return the `return_url` query param, or null if the
 * value is missing/malformed/off-origin.
 *
 * @param rawReturnUrl Raw value pulled from `ActivatedRoute.snapshot.queryParamMap.get('return_url')`.
 * @param currentLocation Window Location shim -- accepted as a param
 *                        so tests can pass a stub without touching
 *                        `window.location`.
 */
export function resolveReturnUrl(
  rawReturnUrl: string | null,
  currentLocation: { origin: string } = window.location,
): string | null {
  if (!rawReturnUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawReturnUrl);
  } catch {
    // Not an absolute URL. Reject: relative URLs are ambiguous when
    // the SPA is served under `/sign/` and could accidentally point
    // back to the ceremony itself.
    return null;
  }

  // Only http(s). Reject javascript:, data:, file:, etc.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  // Same-origin only. Protects against phishing return_urls slipped
  // into an email footer.
  if (parsed.origin !== currentLocation.origin) {
    return null;
  }

  return parsed.toString();
}
