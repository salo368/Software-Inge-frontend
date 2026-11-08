# E2E tests (Playwright)

End-to-end smoke tests for the signing feature. Two specs:

| Spec | What it covers | Status |
| --- | --- | --- |
| `specs/signing-standalone.spec.ts` | Seeds a process to `SIGNATURE` via API, opens `/sign/{signature_id}?e2e=1` with no `return_url` and drives the wizard from `FORM` to `OTP`. | active (needs face fixture) |
| `specs/portal-to-payment.spec.ts` | Full journey: register user, seed process, open portal, click "Firmar ahora", complete the ceremony, return to portal, land on payment. | `fixme` (needs the OTP) |

Both use the `window.__signingE2E` hook installed by
`projects/signing/src/app/core/e2e-hooks.ts`. The hook is gated by an
E2E-enabled `environment.stage` AND `?e2e=1` on the URL.

Signatures can no longer be opened over HTTP (`create_signature` is an
internal Lambda that only `processes.generate_sign` calls), so the seed
walks the real process flow: `create-process` -> `upsert-form` ->
`set-process-form` -> upload `BANK_CERT` -> poll until the process has a
`signature_id`.

**OTP:** the backend dropped the debug OTP echo; `set-otp` only emails the
code. Anything past the OTP screen needs a real source of the code (test
mailbox or test endpoint). Until then `portal-to-payment` is `fixme`. PAREX
(`parex/`) covers the same journey and has the same limitation.

## Quick start

```bash
cd Software-Inge-frontend
cp e2e/.env.example e2e/.env
# fill in FRONTEND_BASE_URL and the *_API_URL values
# optionally: export SIGNATURES_TEST_FACE_PATH=/absolute/path/to/face.jpg

npm install                 # first time only
npx playwright install chromium  # first time only

npm run e2e                 # headless (CI-like)
npm run e2e:headed          # watch the browser
npm run e2e:ui              # interactive Playwright inspector
```

## What each env var is for

See `.env.example` for the full annotated template. TL;DR:

* `FRONTEND_BASE_URL` -- CloudFront root, e.g. `https://d1xxx.cloudfront.net`.
* `AUTH_API_URL`, `BANKS_API_URL`, `FORMS_API_URL`, `FILES_API_URL`,
  `PROCESSES_API_URL` -- one per backend service. Get them with
  `aws cloudformation describe-stacks --stack-name cdts-dev-<svc>`.
* `SIGNATURES_TEST_FACE_PATH` -- optional. When unset, both specs
  skip. See `fixtures/README.md`.

## Why go through a test hook and not real camera automation?

`camera-capture.component` reads from `<video>` populated by
`getUserMedia`. Even with Chromium's fake video device, the guide-box
crop is fiddly and the frames aren't recognized as faces by
Rekognition (blank green square).

The hook wires the same evidence blobs into the same `onCaptured` /
`submitSignature` code paths the real UI uses, so the wizard state
machine, polling loop, error handling, and screen transitions are
exercised as-is. The only thing we're not testing is the video
capture + crop step -- which is a Web API concern, not a business
logic concern.

Full rationale is in
`projects/signing/src/app/core/e2e-hooks.ts`.

## CI

`.github/workflows/e2e.yml` runs the suite on manual dispatch against
dev. It reads the API URLs from the `dev` environment vars, including
`FORMS_API_URL`.
