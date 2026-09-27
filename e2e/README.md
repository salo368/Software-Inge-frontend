# E2E tests (Playwright)

End-to-end smoke tests for the signing feature. Two specs:

| Spec | What it covers | Depends on |
| --- | --- | --- |
| `specs/signing-standalone.spec.ts` | Opens a raw ceremony via `POST /signatures` and drives the wizard through every screen up to the async sign boundary. Doesn't touch the portal. | signatures API + service key + face fixture |
| `specs/portal-to-payment.spec.ts` | Full journey: register user, seed process, open portal, click "Firmar ahora", complete the ceremony, return to portal, land on payment. | all backend services + face fixture |

Both use the `window.__signingE2E` hook installed by
`projects/signing/src/app/core/e2e-hooks.ts`. The hook is gated by
`environment.stage === 'dev'` AND `?e2e=1` on the URL, so it never
ships in the pro bundle and cannot be exercised against a prod
deployment even if someone knew a `sign_id`.

## Quick start

```bash
cd Software-Inge-frontend
cp e2e/.env.example e2e/.env
# fill in FRONTEND_BASE_URL, SIGNATURES_SERVICE_KEY, DEBUG_OTP_KEY_HEX, etc.
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
* `*_API_URL` -- one per backend service. Get them with
  `aws cloudformation describe-stacks --stack-name cdts-dev-<svc>`.
* `SIGNATURES_SERVICE_KEY` -- shared M2M secret. In SSM at
  `/cdts/dev/signatures/service-key`.
* `DEBUG_OTP_KEY_HEX` -- unlocks the `_debug_otp` echo in
  `request_otp`. In SSM at `/cdts/dev/signatures/debug-otp-key`
  (only bootstrapped in dev by `scripts/bootstrap-signatures-v2.sh`).
* `SIGNATURES_TEST_FACE_PATH` -- optional. When unset, both specs
  skip. See `fixtures/README.md`.

## Why go through a test hook and not real camera automation?

`camera-capture.component` reads from `<video>` populated by
`getUserMedia`. Even with Chromium's fake video device, the guide-box
crop is fiddly and the frames aren't recognized as faces by
Rekognition (blank green square). We'd have to build + serve a Y4M
face video, then race the video's timestamp against the "click
capture" moment.

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
dev. Not part of the deploy-dev pipeline (yet) because the async sign
worker takes 30-90s and we don't want to slow every push. Trigger it
before promoting to pro.
