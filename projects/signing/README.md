# `signing` micro-frontend

SPA independiente responsable de conducir a un firmante a través de la
ceremonia de firma. Vive detrás de la misma CloudFront que los demás
bloques (`portal`, `simulator`) bajo la ruta `/sign/`.

## Alcance

* **Un endpoint humano:** `/sign/:sign_id` — el `sign_id` es la
  capability token. No hay bearer ni cookie: cualquiera con el link
  puede llevar la ceremonia hasta el final, por eso el TTL server-side
  es corto (ver `Signatures.expires_at` en el backend).
* **Un backend:** el service `signatures` (`v2`). Nunca habla con
  `processes`, `files`, `auth`, ni ningún otro service — eso es
  responsabilidad del portal.
* **Dos caminos de entrada:**
  1. **Email link asíncrono** — el usuario recibe `/sign/{sign_id}` sin
     `return_url` y firma en otro dispositivo. Al terminar ve un CTA
     genérico ("podés cerrar esta pestaña").
  2. **Portal same-tab** — el portal redirige a
     `/sign/{sign_id}?return_url={encodeURIComponent(process_url)}`
     y cuando la firma termina la SPA envía al usuario de vuelta.

## Estado — máquina server-authoritative

La UI **no** decide transiciones: en cada tick (poll de 4s, 2s durante
`signing`) lee `Ceremony.stage` del backend y computa el screen local.
Si dos pestañas están abiertas y una avanza, la otra converge sola.

| `Ceremony.stage` | Screen local | Notas |
| --- | --- | --- |
| `created` | `review` (local) o `identity` | En refresh mid-flow saltamos directo a `identity`. |
| `identity` | `identity` o `signature` | La SPA parte `identity` en dos screens según el estado de las 4 evidencias. |
| `consent` | `consent` | Checkbox + `POST /consent`. Encadena `request_otp` en el mismo click. |
| `otp` | `otp` | 6 dígitos + verify. |
| `signing` | `signing` | Loading indeterminado; timeout blando a 3 min. |
| `signed` | `done` | Muestra hash + link a `signed.pdf` presignado (15 min TTL) + CTA de retorno. |
| `failed` / `expired` | `failed` / `expired` | Terminales. La SPA **no** reintenta desde acá; el reopen se hace desde el portal (`POST /processes/{id}/advance` con la lógica de "reopen"). |

Ver `pages/sign.component.ts` para la máquina completa y
`docs/signatures-v2.md §10.4` (en el repo del backend) para el contrato
con `signatures`.

## Módulos internos

```
src/app/
├── core/
│   ├── signatures.service.ts      # cliente HTTP v2 (11 endpoints + tipos)
│   ├── host-app.ts                # validación de ?return_url (same-origin only)
│   └── e2e-hooks.ts               # window.__signingE2E (dev + ?e2e=1)
├── pages/
│   ├── sign.component.ts          # wizard state machine
│   ├── sign.component.html
│   ├── missing-sign-id.component.ts
│   └── sign/
│       ├── camera-capture.component.ts   # <video>+getUserMedia + crop guiado
│       ├── signature-pad.component.ts    # <canvas> pointer drawing → PNG
│       └── pdf-preview.component.ts      # pdf.js embed
├── app.routes.ts
├── app.config.ts
└── environments/
    ├── environment.ts             # dev — signaturesApiUrl único
    └── environment.pro.ts         # pro — same shape
```

`environment.ts` está intencionalmente vacío salvo por
`signaturesApiUrl`. La SPA no consume ninguna otra API — todo lo demás
(nombre del firmante, PDF original, etc.) llega vía la ceremony.

## Descubrir la API URL

El id del API Gateway cambia si el stack `cdts-<stage>-signatures` se
recrea (destructive migration, `sls remove`, etc.). Cuando pasa,
`environment.ts` queda desactualizado y la SPA muestra "Enlace no
valido" para cualquier ceremony (CORS + 404).

```bash
aws cloudformation describe-stacks \
  --stack-name cdts-dev-signatures \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" \
  --output text
```

Actualizar `environment.ts` en el mismo PR que produjo la recreación.
El header del archivo repite estas instrucciones.

## Seguridad

* **`return_url`** obligatoriamente absoluta, `http[s]:`, y **same-origin**
  con `window.location`. URLs off-origin se descartan silenciosamente.
  Defensa contra `?return_url=https://evil.com/steal` en un email
  interceptado (ver `core/host-app.ts`).
* **Test hooks** aparecen solo si BOTH `stage === 'dev'` AND `?e2e=1`.
  Nunca en pro. Ver `core/e2e-hooks.ts` para el argumento completo.
* **Debug OTP** — la SPA nunca sabe el HMAC key por sí sola. El
  Playwright driver lo inyecta vía `setDebugOtpKey(hex)` y la SPA lo
  reenvía al backend en `X-Debug-OTP-Signature`. En pro el key no
  existe en SSM y el backend ignora el header.

## Desarrollo local

```bash
# desde la raíz del repo
npm install
npm run start:signing        # ng serve signing → http://localhost:4200
```

El dev server sirve `/`, pero la SPA espera vivir bajo `/sign/`. Para
un smoke test navegar a `http://localhost:4200/sign/<algún-sign_id-válido>`
(hay que abrir la ceremony contra el backend real primero — el bootstrap
lo hace `scripts/e2e-signature.py` en el repo del backend).

## Tests

* **Unit** — `ng test` (Karma + Jasmine). Cubre `signatures.service`,
  `host-app`, `e2e-hooks`.
* **E2E Playwright** — ver `e2e/README.md` en la raíz del repo.
  Dos specs: `signing-standalone` y `portal-to-payment`. Corren solo
  en dispatch manual del workflow `e2e.yml` (no en el critical path
  del deploy).
