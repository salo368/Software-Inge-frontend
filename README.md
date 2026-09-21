# Proyecto Ingeniería de Software · Frontend

> **Ejercicio academico** de la Pontificia Universidad Javeriana. No es un producto
> real ni esta asociado a ninguna empresa; existe para practicar Angular, despliegue
> en CloudFront y buenas practicas de repositorio.

Frontend en **Angular 18**, partido en **micro frontends**: tres aplicaciones
independientes que se compilan y despliegan por separado, y que CloudFront
compone bajo un solo dominio.

Consume las APIs del backend, que vive en un repo aparte:
[`salo368/Software-Inge-backend`](https://github.com/salo368/Software-Inge-backend).

## Bloques

Igual que el backend se divide en servicios, el frontend se divide en bloques.
Cada uno es una SPA completa con su propio `index.html`, su propio bundle y su
propio bucket.

| Bloque | Ruta | Sesion | Que hace |
|---|---|---|---|
| `simulator` | `/` y `/docs` | no | Landing, simulador de tasas y documentacion |
| `portal` | `/portal/*` | si | Login, registro, cuenta y wizard del proceso |
| `signing` | `/sign/*` | no, el token es la credencial | Ceremonia de firma electronica |

El codigo vive en `projects/<bloque>/`, y lo comun en `projects/shared/`,
importable como `@shared/*`.

### Por que esta partido asi

El motivo es **disponibilidad**. Al no haber nada compartido en tiempo de
ejecucion, un despliegue roto de un bloque no puede tumbar a los otros: son
documentos distintos, servidos desde buckets distintos. El precio es que cruzar
de un bloque a otro recarga la pagina y cada bloque trae su propio runtime de
Angular.

Se descarto Module Federation justamente por eso: el shell que carga los
remotes en runtime es un punto unico de fallo, y compartir Angular entre builds
acopla las versiones de los bloques entre si.

### `signing` es un bloque aparte a proposito

No depende de `@shared` ni conoce el dominio del producto. Todo lo que sabe del
resto de la aplicacion esta en
[`projects/signing/src/app/core/host-app.ts`](./projects/signing/src/app/core/host-app.ts),
un archivo de tres lineas con la URL de retorno. La idea es poder usarlo para
firmar cualquier documento, no solo los de este proyecto.

### Como se comunican los bloques

- **Navegacion**: `blockUrl()` en
  [`projects/shared/src/core/blocks.ts`](./projects/shared/src/core/blocks.ts)
  arma las URLs entre bloques. Son navegaciones normales del navegador, no
  rutas de Angular.
- **Sesion**: vive en `localStorage`, que es por origen. Como los tres bloques
  se sirven del mismo dominio de CloudFront, la sesion cruza sin trabajo extra.

## Relacion con el backend

Los dos repos se despliegan por separado y **no comparten pipeline**. El unico
punto de contacto es AWS:

- El frontend consume los HTTP API de cada servicio del backend. Las URLs estan
  en `projects/shared/src/environments/`. El bloque `signing` tiene las suyas en
  `projects/signing/src/environments/`, porque no depende de `shared`.
- Este stack publica su URL de CloudFront en el parametro SSM
  `/cdts/<stage>/frontend/url`. El backend lo lee en runtime para armar enlaces
  absolutos hacia la SPA (por ejemplo el correo de la ceremonia de firma), sin
  que ninguno de los dos stacks dependa del otro al desplegar.

## Infraestructura

**Un bucket S3 privado por bloque + una distribucion de CloudFront con Origin
Access Control (OAC)**, definida en [`serverless.yml`](./serverless.yml) con
Serverless Framework v3. No hay Lambdas: solo `resources`, y
`package.patterns: ['!./**']` para no subir nada como zip.

| Recurso | Nombre |
|---|---|
| Stack CFN | `cdts-<stage>-frontend` |
| Buckets | `cdts-<stage>-frontend-{simulator,portal,signing}-<accountId>` |
| Edge function | `cdts-<stage>-frontend-spa-router` |
| Parametro SSM | `/cdts/<stage>/frontend/url` |

Los buckets estan bloqueados al publico: solo CloudFront lee, via bucket policy
con condicion sobre `aws:SourceArn`.

### La composicion: quien resuelve que

CloudFront tiene un *cache behavior* por bloque (`/portal/*`, `/sign/*`, y el
resto al bloque raiz), cada uno apuntando a su bucket.

El fallback de la SPA no puede ser global, porque un 404 dentro de `/portal/`
tiene que devolver el `index.html` **del portal** y no el del simulador. De eso
se encarga [`infra/spa-router.js`](./infra/spa-router.js), una CloudFront
Function en *viewer request* que manda las rutas sin extension al `index.html`
del bloque que corresponda. Sus casos estan cubiertos en
[`infra/spa-router.test.js`](./infra/spa-router.test.js), que corre en el job
`validate`; un error ahi enviaria los enlaces de un bloque al origen de otro.

Es una CloudFront Function y no Lambda@Edge a propósito: es mas barata, se
ejecuta en microsegundos y no necesita permisos de `lambda:*`, que el usuario de
despliegue tiene explicitamente denegados.

Cada bloque sube a su bucket bajo el prefijo que coincide con su `baseHref`
(`portal/`, `sign/`, y raiz para el simulador), y
[`scripts/ci/block-info.sh`](./scripts/ci/block-info.sh) deriva ese prefijo del
propio `angular.json` para que el layout en S3 no pueda desalinearse del build.

## Ambientes

Solo dos stages: `dev` y `pro`. No usar `prod`, `staging`, `qa`.

| Stage | Rama | GitHub Environment | Usuario IAM |
|---|---|---|---|
| `dev` | `develop` | `dev` | `github-actions-dev-frontend-deployer` |
| `pro` | `main` | `pro` | `github-actions-pro-frontend-deployer` |

Region unica `us-east-1`, cuenta AWS `658548982073` (la misma del backend).

Las configuraciones de Angular se llaman `dev` y `pro` (renombradas de las
`development`/`production` que genera el CLI). `pro` usa `fileReplacements` para
sustituir los `environment.ts` por los `environment.pro.ts`.

## Setup local

```bash
nvm use            # ver .nvmrc
npm install
npm start          # simulator en http://localhost:4200
npm run start:portal    # portal  en http://localhost:4201
npm run start:signing   # signing en http://localhost:4202
```

Apunta a las APIs de `dev`, asi que no hace falta levantar el backend.

Con `ng serve` cada bloque corre en su propio puerto, asi que los enlaces entre
bloques (que son rutas absolutas como `/portal/login`) no resuelven en local.
Para probar la composicion completa hay que desplegar a `dev`.

## Build

```bash
npm run build              # los tres bloques
npm run build:portal       # uno solo
npx ng build signing --configuration pro
```

Los artefactos quedan en `dist/<bloque>/browser/`.

## Deploy

Va por GitHub Actions: push a `develop` despliega `dev`, push a `main` despliega
`pro`. Ambos workflows delegan en
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), que copia la
forma del pipeline del backend: `plan → validate → infrastructure → blocks →
summary`.

1. **Plan** — [`scripts/ci/plan-deploy.sh`](./scripts/ci/plan-deploy.sh) mira el
   diff (anclado al **ultimo deploy exitoso** de este workflow en la rama, no al
   parent del push — asi un pipeline previo que fallo en Validate no pierde su
   cambio de infra) y decide que bloques tocar y si hace falta infra. Cambios
   en `projects/shared/`, `angular.json`, `package.json`, `tsconfig*.json`,
   `.nvmrc`, `scripts/ci/deploy.sh` o `.github/workflows/**` son
   **transversales**: disparan los tres bloques. Cambios en un solo bloque,
   solo ese; cambios en docs, ninguno.
2. **Validate** — corre los tests del router del edge y compila los tres bloques
   como sanity workspace-wide. Si falla, no se despliega nada.
3. **Infrastructure** — `sls deploy` del stack compartido (CloudFront + S3 por
   bloque + edge function). Solo si el plan asi lo pidio (`serverless.yml` o
   `infra/**` cambiaron, o `force_infra: true`). Es el paso lento (CloudFront
   puede tardar varios minutos en converger), asi que los cambios de codigo se
   lo saltan.
4. **Blocks** — matrix, un call a
   [`.github/workflows/block-package.yml`](./.github/workflows/block-package.yml)
   por bloque. Cada bloque corre en paralelo con su propia cadena
   **validate → test → deploy → integration**, igual que un servicio del
   backend:
   - **validate**: `ng build <block>` de sanity.
   - **test**: detecta `*.spec.ts` bajo `projects/<block>/src/`. Sin specs,
     skip con `::notice::` (verde). Con specs, corre Karma headless.
   - **deploy**: [`scripts/ci/deploy.sh`](./scripts/ci/deploy.sh) sube a S3 con
     `Content-Type` explicito por extension (el `aws s3 sync` a secas adivina
     mal y sirve los `.js` como `text/plain`, lo que rompe la SPA), aplica
     `Cache-Control: immutable` a los assets hasheados y `no-cache` a
     `index.html`, borra huerfanos e invalida **solo las rutas de ese bloque**.
   - **integration**: dev-only y **non-blocking**. Detecta `projects/<block>/e2e/`
     (Playwright) o `projects/<block>/cypress/` (Cypress). Sin suite, skip con
     `::notice::` (verde). Con suite, corre contra la URL recien desplegada.
5. **Summary** — descarga los artifacts `block-status-*` +
   `infrastructure-status` y renderiza una tabla por bloque/stage con donde
   paro cada uno, la URL desplegada y el estado de tests/integration.

Para desplegar un bloque a mano, correr el workflow con `block: portal`. Para
forzar el paso de infra sin tocar `serverless.yml`, con `force_infra: true`.
Para redeploy completo, `block: __all__`.

> Todavia no hay `*.spec.ts` ni `e2e/` en ningun bloque — el pipeline los
> **skippea limpiamente**, marcando la celda como `no specs` / `no e2e` en el
> summary. Cuando se agreguen (por ejemplo la E2E Playwright de la ceremonia
> de firma), el pipeline los recoge sin cambios en workflow.

## Agregar un bloque nuevo

1. Crear `projects/<nombre>/` con la misma forma que los existentes.
2. Registrarlo en `angular.json` con su `baseHref` (`/<nombre>/`).
3. Agregar su bucket, su origen y su cache behavior en `serverless.yml`.
4. Agregar el prefijo a `BLOCK_PREFIXES` en `infra/spa-router.js` y su caso en
   el test.
5. Agregarlo a `BLOCK_BASE` en `projects/shared/src/core/blocks.ts`.

El plan de deploy lo descubre solo: no hay que registrarlo en ningun script.

## Flujo de trabajo

- Todo cambio va por Pull Request. No se hace push directo a `main`.
- Ramas desde `main`: `feat/<nombre>`, `fix/<nombre>`, `chore/<nombre>`.
- Cada rama abre dos PRs: uno a `develop` (desplegar y probar en dev) y otro a
  `main` (desplegar en pro). `develop` y `main` nunca se mergean entre si.
