# E2E fixtures

Binary assets fed to the signing SPA by the Playwright tests via the
`window.__signingE2E` hook (see
`projects/signing/src/app/core/e2e-hooks.ts`).

## Contents

| File | Used for | Notes |
| --- | --- | --- |
| `id-front.png` | `submitEvidence('id_front', ...)` | Synthetic PNG with printed ID-like text. Textract must find >= 1 line for `validate_id_front` to pass. |
| `id-back.png`  | `submitEvidence('id_back', ...)`  | Same shape, back copy. |
| `signature.png`| `submitSignature(...)`            | Small hand-drawn-looking scribble on white. Just needs non-blank pixels; no server validation. |

Regenerate with `bash e2e/fixtures/regenerate.sh`. The script shells
into `Software-Inge-backend` (must be a sibling checkout) and reuses
`backend/tests/integration_signatures.py:make_synthetic_id_png /
make_synthetic_signature_png` so the frontend and backend agree on
what counts as a valid ID or signature. Requires Python + Pillow.

## Face image (opt-in)

The face fixture is NOT checked in. Set `SIGNATURES_TEST_FACE_PATH` to
an absolute path pointing at a JPEG showing a single face with clearly
open eyes -- Rekognition needs both signals for `validate_face` to
succeed. Any stock portrait works.

When the env var is unset, `portal-to-payment.spec.ts` skips gracefully
and the standalone spec drives only the pre-face steps.
