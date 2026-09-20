# CDTS · Frontend

SPA en **Angular 18** para la plataforma de CDTs: simulador de tasas, apertura de
procesos, carga de documentos y ceremonia de firma electronica.

Consume las APIs del backend, que vive en un repo aparte:
[`salo368/Software-Inge-backend`](https://github.com/salo368/Software-Inge-backend).

## Relacion con el backend

Los dos repos se despliegan por separado y **no comparten pipeline**. El unico
punto de contacto es AWS:

- El frontend consume los HTTP API de cada servicio del backend. Las URLs estan
  en `src/environments/environment.ts` (dev) y `environment.pro.ts` (pro).
- Este stack publica su URL de CloudFront en el parametro SSM
  `/cdts/<stage>/frontend/url`. El backend lo lee en runtime para armar enlaces
  absolutos hacia la SPA (por ejemplo el correo de la ceremonia de firma), sin
  que ninguno de los dos stacks dependa del otro al desplegar.

## Infraestructura

**S3 privado + CloudFront con Origin Access Control (OAC)**, definida en
[`serverless.yml`](./serverless.yml) con Serverless Framework v3. No hay Lambdas:
solo `resources`, y `package.patterns: ['!./**']` para no subir nada como zip.

| Recurso | Nombre |
|---|---|
| Stack CFN | `cdts-<stage>-frontend` |
| Bucket | `cdts-<stage>-frontend-web-<accountId>` |
| Parametro SSM | `/cdts/<stage>/frontend/url` |

El bucket esta bloqueado al publico: solo CloudFront lee, via bucket policy con
condicion sobre `aws:SourceArn`. CloudFront devuelve `/index.html` con 200 ante
403/404, que es lo que hace funcionar el routing de Angular.

## Ambientes

Solo dos stages: `dev` y `pro`. No usar `prod`, `staging`, `qa`.

| Stage | Rama | GitHub Environment | Usuario IAM |
|---|---|---|---|
| `dev` | `develop` | `dev` | `github-actions-dev-frontend-deployer` |
| `pro` | `main` | `pro` | `github-actions-pro-frontend-deployer` |

Region unica `us-east-1`, cuenta AWS `658548982073` (la misma del backend).

Las configuraciones de Angular se llaman `dev` y `pro` (renombradas de las
`development`/`production` que genera el CLI). `pro` usa `fileReplacements` para
sustituir `environment.ts` por `environment.pro.ts`.

## Setup local

```bash
nvm use            # ver .nvmrc
npm install
npm start          # ng serve en http://localhost:4200
```

Apunta a las APIs de `dev`, asi que no hace falta levantar el backend.

## Build

```bash
npx ng build --configuration dev   # o pro
```

Los artefactos quedan en `dist/cdts-frontend/browser/`.

## Deploy

Va por GitHub Actions: push a `develop` despliega `dev`, push a `main` despliega
`pro`. Ambos workflows delegan en
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), que hace:

1. **Infra** — `sls deploy`, pero **solo si hace falta**: si cambio
   `serverless.yml` o el stack todavia no existe. Un cambio que solo toca codigo
   de la app se salta este paso, que es el que se tarda (CloudFront puede
   demorar varios minutos en converger).
2. **Build** — `ng build --configuration <stage>`.
3. **Upload** — [`scripts/ci/deploy.sh`](./scripts/ci/deploy.sh) sube a S3 con
   `Content-Type` explicito por extension (el `aws s3 sync` a secas adivina mal y
   sirve los `.js` como `text/plain`, lo que rompe la SPA), aplica
   `Cache-Control: immutable` a los assets hasheados y `no-cache` a
   `index.html`, borra huerfanos e invalida CloudFront.

Para forzar el paso de infra sin tocar `serverless.yml`, correr el workflow a
mano con `force_infra: true`.

## Flujo de trabajo

- Todo cambio va por Pull Request. No se hace push directo a `main`.
- Ramas desde `main`: `feat/<nombre>`, `fix/<nombre>`, `chore/<nombre>`.
- Cada rama abre dos PRs: uno a `develop` (desplegar y probar en dev) y otro a
  `main` (desplegar en pro). `develop` y `main` nunca se mergean entre si.
