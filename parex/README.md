# PAREX — validación funcional post-deploy

Suite de Playwright que valida el frontend desplegado de punta a punta, contra
una URL real (CloudFront de `dev` o `pro`), no contra un servidor local. Corre
automáticamente al final de cada deploy exitoso (job `parex` en
[`deploy-dev.yml`](../.github/workflows/deploy-dev.yml)), **no** dentro de la
matriz por bloque.

## Por qué existe aparte del `integration` de `block-package.yml`

`block-package.yml` ya tiene su propio job `integration` (dev-only, detecta
`projects/<bloque>/e2e/` o `projects/<bloque>/cypress/`). Son dos mecanismos
distintos, no uno reemplaza al otro:

| | `integration` de `block-package.yml` | PAREX |
|---|---|---|
| Alcance | Un bloque a la vez | Los tres bloques, un recorrido completo |
| Dónde vive la suite | `projects/<bloque>/e2e/` (por bloque) | `parex/` (a nivel de repo) |
| Cuándo corre | Dentro de la matriz, por cada bloque desplegado | Una sola vez, después de que los tres bloques y la infraestructura ya desplegaron |
| Estado hoy | Sin activar en ningún bloque (ningún `projects/<bloque>/e2e/` existe todavía) | Activo, con specs reales (`EUV-UC2/3`, `VAL-AUTH`, `VAL-REG`) |

La razón de fondo es la misma que ya explica `e2e/` (ver más abajo): un
recorrido como "registrarse en simulator, avanzar en portal, firmar en
signing, volver a portal" cruza tres bloques, y ningún `integration` por
bloque puede expresar eso — cada uno solo ve el suyo recién desplegado. PAREX
es donde vive esa clase de prueba.

## Relación con `e2e/`

`e2e/` (ver [`../e2e/README.md`](../e2e/README.md)) es más antigua y más
angosta: dos specs enfocados solo en la ceremonia de firma, disparados a mano
(`workflow_dispatch`), nunca en el camino crítico del deploy. PAREX es más
amplia (todo el recorrido de originación, autenticación y registro) y corre
sola, automáticamente, en cada deploy a `dev`. Las dos conviven hoy; ninguna
reemplaza a la otra todavía.

## Estructura

```
parex/
  config/environments.ts   # URL base por ambiente (dev/pro)
  playwright.config.ts      # projects: "setup" (auth) -> "authenticated" | "public"
  tests/
    auth.setup.ts            # loguea un usuario de prueba, guarda storageState
    euv/
      uc2/EUV-UC2-001...     # Escenario de uso válido, UC2 (registro público)
      uc3/EUV-UC3-001..013   # Escenario de uso válido, UC3 (recorrido completo de originación)
    validation/
      auth/VAL-AUTH-*        # Validaciones negativas/positivas de autenticación
      register/VAL-REG-*     # Validaciones de registro
    support/                 # Helpers de flujo reutilizados entre specs (uc3/, signing/)
    fixtures/signing/        # Imágenes de prueba para la ceremonia de firma
```

Los specs `*.public.spec.ts` corren sin sesión (`project: public`); el resto
corre autenticado, reutilizando el `storageState` que genera `auth.setup.ts`
una sola vez por corrida.

## Correr localmente

```bash
cd Software-Inge-frontend
npm install
npx playwright install --with-deps chromium

# TEST_ENV selecciona config/environments.ts; por defecto es "dev".
TEST_ENV=dev npm run parex:e2e

# Ver el último reporte HTML generado:
npm run parex:e2e:report
```

Variables de entorno esperadas (ver `deploy-dev.yml`, job `parex`, para la
lista completa tal como la usa CI): `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`,
opcionalmente `SIGNATURES_TEST_FACE_PATH` para la validación biométrica y
`SIGNATURES_TEST_EMAIL` para el correo del firmante (por defecto
`TEST_USER_EMAIL`). Localmente se pueden definir en
`parex/.env.{dev,staging,pro}.local` (no se commitean).

## Flujo que valida UC3 (contrato actual del backend)

| EUV | Qué valida | Estado |
|---|---|---|
| 001 | Abrir un CDT desde el simulador (`GET /banks/simulate` -> `create-process`) | activo |
| 002 | Formulario KYC (`upsert-form` + `set-process-form`) -> `DOCUMENTS` | activo |
| 003 | Documentos requeridos (`BANK_CERT` + `TAX_DECLARATION`, porque el formulario sintético declara renta) | activo |
| 004 | `DOCUMENTS` -> `SIGNATURE` (generate_sign abre la firma) | activo |
| 005 | Iniciar la firma: navegación a `/sign/{signature_id}?return_url=...` | activo |
| 006 | Correo + términos, y validación de identidad (frente, reverso, rostro) | activo (requiere fixture facial) |
| 007 | Firma manuscrita -> `OTP` | activo (requiere fixture facial) |
| 008 | Solicitar el código OTP | activo (requiere fixture facial) |
| 009-013 | Confirmar OTP, firmado, regreso al portal, pago, Mi cuenta | `fixme` |

**Por qué 009-013 están en `fixme`:** el backend ya no expone el OTP de
prueba (`X-Debug-OTP-Signature` / `_debug_otp` se eliminaron; `set-otp` solo
envía el código por correo). Sin una fuente automatizable del código no hay
forma de confirmarlo. Para reactivarlos basta con implementar
`resolveOtpProvider()` en `tests/support/signing/signing-test-env.ts` (un
buzón de prueba leído por IMAP/API, o un endpoint de prueba en dev/staging):
los specs ya están escritos contra el flujo nuevo, incluido el pago con
comprobante (`payments`) y el estado final `REVIEW`.
