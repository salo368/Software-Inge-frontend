# `backoffice` micro-frontend

Herramientas internas para administradores. Vive detras de la misma CloudFront
que los demas bloques, bajo `/backoffice/`.

## Acceso

- Login con el servicio `admin_auth` del backend
  (`docs/admin-auth-api.md`): `POST /admin-auth/login`, `GET /admin-auth/me`,
  `POST /admin-auth/logout`.
- **No hay registro abierto.** Un admin crea a los demas (`POST
  /admin-auth/register`, con su token); el primero de cada stage se crea con
  `scripts/create-first-admin.py` del backend.
- Los tokens de admin (24 h) son distintos de los de inversionista. Se guardan
  en `localStorage` con claves propias (`cdts_admin_token`, `cdts_admin`), asi
  que una sesion no pisa a la otra aunque compartan origen.
- Cualquier `401` con sesion limpia el token y manda a `/backoffice/login`.

## Estructura

- `src/environments/` — `adminAuthApiUrl` por stage (HttpApiUrl del stack
  `cdts-<stage>-admin-auth`). `dev` y `pro` siguen en `PENDING-FIRST-DEPLOY`
  hasta que el servicio se despliegue ahi.
- `src/app/core/` — `AdminAuthService`, interceptor, guards y copy de errores.
- `src/app/pages/` — login y panel (las herramientas se iran agregando).

El favicon es `public/favicon-backoffice.svg` (se sirve desde la raiz, como los
demas).

## Local

```bash
npm run start:backoffice   # http://localhost:4203/backoffice/
npm run start:proxy        # y entrar por http://localhost:4300/backoffice/
```

Hay que usar `--configuration staging` (`ng serve backoffice -c staging`) para
apuntar al `admin_auth` de staging.
