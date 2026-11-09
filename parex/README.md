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
| Estado hoy | Sin activar en ningún bloque (ningún `projects/<bloque>/e2e/` existe todavía) | Activo, con specs reales (`EUV-UC2/3`, `VAL-AUTH`, `VAL-REG`, `VAL-SIM`, `VAL-FORM`) |

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
      simulator/VAL-SIM-*    # Simulador: monto, plazo propio, sin cobertura (públicos)
      form/VAL-FORM-*        # Formulario KYC: buscadores, selectores, fechas, montos, indicativo, envío
    support/                 # Helpers de flujo reutilizados entre specs (uc3/, signing/)
      uc3/form-controls.ts   # Cómo se manejan los selectores propios del formulario
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

### Contra el front local (antes de desplegar)

`PAREX_BASE_URL` reemplaza la URL de CloudFront del ambiente. Sirve para probar
un cambio del front sin desplegarlo; el back y los datos siguen siendo los de
`TEST_ENV`. Se necesita el front local detrás del proxy que imita a CloudFront
(un solo origen para simulador, portal y firma):

```bash
npx ng serve simulator --configuration staging --port 4200   # cada uno en su terminal
npx ng serve portal    --configuration staging --port 4201
npx ng serve signing   --configuration staging --port 4202
npm run start:proxy                                          # http://localhost:4300

TEST_ENV=staging PAREX_BASE_URL=http://localhost:4300 \
  TEST_USER_EMAIL=... TEST_USER_PASSWORD=... npm run parex:e2e
```

Variables de entorno esperadas (ver `deploy-dev.yml`, job `parex`, para la
lista completa tal como la usa CI): `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`,
opcionalmente `SIGNATURES_TEST_FACE_PATH` para la validación biométrica y
`SIGNATURES_TEST_EMAIL` para el correo del firmante (por defecto
`TEST_USER_EMAIL`). Localmente se pueden definir en
`parex/.env.{dev,staging,pro}.local` (no se commitean).

## Validaciones del simulador y del formulario

Cubren los controles propios que reemplazaron a los nativos del navegador
(`<select>`, `<input type="date">`, `<input type="number">`):

| Spec | Qué valida | Sesión |
|---|---|---|
| `VAL-SIM-001` | Monto: sin ceros a la izquierda, puntos de miles, solo números, tope de dígitos; la simulación recibe el número limpio | no |
| `VAL-SIM-002` | Plazo propio en días además de los fijos; el resumen no cambia de plazo sin volver a simular | no |
| `VAL-SIM-003` | Sin datos del mercado el resumen muestra guiones (no `0.00 %`) y avisa cuando ninguna entidad cubre lo pedido | no |
| `VAL-FORM-001` | Buscadores de listas largas: orden por relevancia, sin tildes, panel acotado, cascada país -> departamento -> ciudad | sí |
| `VAL-FORM-002` | Selectores cortos: lista con un clic, teclado, obligatoriedad | sí |
| `VAL-FORM-003` | Fechas: máscara `dd/mm/aaaa`, errores, calendario con mes y año, días futuros bloqueados | sí |
| `VAL-FORM-004` | Montos: puntos de miles, ceros, el cero es válido y el vacío no, Backspace sobre un punto | sí |
| `VAL-FORM-005` | Indicativo: bandera real, búsqueda por país o número, código compartido (+1) | sí |
| `VAL-FORM-006` | Lo que recibe el back (claves, fechas ISO, números, indicativo sin `+`) y cómo se vuelve a mostrar | sí |

### Cómo se manejan los selectores propios

El formulario ya no tiene `<select>` nativos: `selectOption` no funciona. Los
ids de los campos son los de siempre (`process-form-*`) y cada lista es
`#<id>-list`. Las opciones se eligen por su **clave** (`data-key`), no por la
etiqueta ni por la posición, con las ayudas de
[`support/uc3/form-controls.ts`](tests/support/uc3/form-controls.ts):

- `pickFixedOption(page, id, key)`: selector corto (`SINGLE`, `CC`...).
- `pickSearchOption(page, id, key, search?)`: escribe para filtrar y elige esa clave
  (`QUINDIO`, `ARMENIA`, o `CO` con `search` = `+57` para el indicativo).
- Las fechas aceptan `fill('1999-11-02')` (se muestran `02/11/1999`) y los montos
  `fill('12000000')` (se muestran `12.000.000`).

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
