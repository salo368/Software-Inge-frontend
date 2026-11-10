# `signing` micro-frontend

SPA independiente responsable de conducir a un firmante a través de la
ceremonia de firma. Vive detrás de la misma CloudFront que los demás
bloques (`portal`, `simulator`) bajo la ruta `/sign/`.

## Alcance

* **Un endpoint humano:** `/sign/:sign_id`, donde el parámetro es el
  `signature_id` y funciona como capability token. No hay bearer ni
  cookie: cualquiera con el link puede llevar la firma hasta el final,
  por eso la ventana server-side es corta (15 min desde `created_at`).
* **Un backend:** el servicio `signatures` (backend
  `docs/signatures-api.md`). Nunca habla con `processes`, `files`,
  `auth` ni ningún otro servicio. La firma la abre el backend
  (`processes.generate_sign`) cuando los documentos del proceso están
  completos; el portal solo recibe el `signature_id`.
* **Dos caminos de entrada:**
  1. **Desde el portal** — redirige a
     `/sign/{signature_id}?return_url={encodeURIComponent(process_url)}&email=...`;
     cuando la firma termina la SPA envía al usuario de vuelta.
  2. **Link suelto** — el mismo `/sign/{signature_id}` sin query params
     (copiado al celular para usar su cámara, por ejemplo). Al terminar
     ve un CTA genérico ("podés cerrar esta pestaña").

## Estado — máquina server-authoritative

La UI **no** decide transiciones: en cada tick (poll de 4s, 2s durante
`SIGNING`) lee `Signature.stage` del backend y computa el screen local.
Si dos pestañas están abiertas y una avanza, la otra converge sola.

| `Signature.stage` | Screen local | Endpoint que la hace avanzar |
| --- | --- | --- |
| `FORM` | `review` (local) y luego `form` | `set-signature-form` (correo + aceptación de términos) |
| `BIOMETRICS` | `identity` | `upload-biometrics` + `set-biometrics` por evidencia; `get-required-biometrics` avanza cuando las 3 son válidas |
| `SIGNATURE` | `signature` | `set-signature-draw` (bytes crudos del PNG); la SPA pide el primer OTP enseguida |
| `OTP` | `otp` | `set-otp` (enviar/reenviar) y `resolve-otp` (6 dígitos, 2 min, 3 intentos) |
| `SIGNING` | `signing` | `sign_doc` asíncrono (el backend lo falla a los 60 s) |
| `SIGNED` | `done` | Hash + link a `signed_url` (15 min TTL) + CTA de retorno |
| `FAILED` | `failed` | Terminal. El backend todavía no reabre firmas. |
| `410 signature_expired` | `expired` | Terminal: se cerró la ventana de 15 min. |

Ver `pages/sign.component.ts` para la máquina completa.

## Módulos internos

```
src/app/
├── core/
│   ├── signatures.service.ts      # cliente HTTP (9 endpoints + tipos)
│   ├── host-app.ts                # validación de ?return_url (same-origin only)
│   └── e2e-hooks.ts               # window.__signingE2E (E2E-enabled stage + ?e2e=1)
├── pages/
│   ├── sign.component.ts          # wizard state machine
│   ├── sign.component.html
│   ├── missing-sign-id.component.ts
│   └── sign/
│       ├── camera-capture.component.ts   # <video>+getUserMedia + crop guiado
│       ├── signature-pad.component.ts    # <canvas> pointer drawing → PNG
│       ├── pdf-preview.component.ts      # pdf.js embed + caja de firma
│       └── sign-copy.ts                  # textos de error/rechazo
├── app.routes.ts
├── app.config.ts
└── environments/
    ├── environment.ts             # dev — signaturesApiUrl único
    ├── environment.staging.ts     # staging — same shape
    └── environment.pro.ts         # pro — same shape
```

`environment.ts` está intencionalmente vacío salvo por
`signaturesApiUrl`. La SPA no consume ninguna otra API — todo lo demás
(PDF original, cajas de firma, ventana) llega vía `get-signature`.

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
* **Test hooks** aparecen solo en stages E2E habilitados (`dev`/`staging`/`pro`)
  y con `?e2e=1`. No dan ninguna capacidad extra: el OTP sigue llegando
  solo al correo del firmante. Ver `core/e2e-hooks.ts`.

## Desarrollo local

```bash
# desde la raíz del repo
npm install
npx ng serve signing --configuration staging   # http://localhost:4202/sign/
```

Para un smoke test navegar a
`http://localhost:4202/sign/<signature_id>?email=<correo>`. El
`signature_id` sale de un proceso en `SIGNATURE` (`GET
/processes/get-processes`); la firma vive 15 minutos.

## Tests

* **Unit** — `npx ng test signing` (Karma + Jasmine). Cubre
  `signatures.service`, `host-app` y los textos de rechazo.
* **E2E Playwright** — PAREX (`parex/`, EUV-UC3-005..013) y `e2e/`.
  Los pasos posteriores al OTP están en `fixme` porque el backend ya no
  expone un OTP de prueba.
