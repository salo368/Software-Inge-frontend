# IAM bootstrap para GitHub Actions (frontend)

Credenciales que usan los workflows de este repo. Son **propias del frontend**: el
backend tiene las suyas en su repo, y ninguna de las dos puede desplegar lo del
otro.

## Recursos creados

| Recurso | ARN |
|---|---|
| Policy | `arn:aws:iam::658548982073:policy/CdtsFrontendDeploy` |
| User (dev) | `arn:aws:iam::658548982073:user/githubactions/github-actions-dev-frontend-deployer` |
| User (pro) | `arn:aws:iam::658548982073:user/githubactions/github-actions-pro-frontend-deployer` |

Las access keys estan cargadas como GitHub Environment Secrets:

- Environment `dev` -> `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Environment `pro` -> `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

La region es una repo variable: `AWS_REGION=us-east-1`.

## Filosofia de permisos

[`frontend-deploy-policy.json`](./frontend-deploy-policy.json) es la fuente de
verdad. Esta acotada a lo que el stack necesita y nada mas:

- **CloudFormation** solo sobre stacks `cdts-*-frontend`. Las acciones de listado
  y `ValidateTemplate` van sin scope porque AWS no las soporta a nivel de recurso.
- **S3** solo sobre buckets `cdts-*-frontend*`. El patron cubre el bucket de cada
  bloque (`cdts-<stage>-frontend-{simulator,portal,signing}-<accountId>`) y el de
  deployment que Serverless crea dentro del propio stack.
- **CloudFront** sin scope de recurso: el id de la distribucion solo se conoce
  despues de crearla, asi que no hay ARN que escribir de antemano. Es aceptable
  porque CloudFront no lo usa nadie mas en la cuenta. Incluye las acciones de
  **CloudFront Functions**, que es lo que compone los bloques en el edge.
- **SSM** solo sobre `/cdts/*/frontend/*`, que es el parametro donde el stack
  publica su URL para que el backend arme enlaces absolutos.
- **Sin permisos IAM.** El stack no crea roles porque no tiene Lambdas, asi que
  este usuario no necesita tocar IAM en absoluto.
- **Deny explicito** sobre Lambda, API Gateway, RDS, Rekognition e IAM: aunque
  los Allow de arriba ya no los conceden, el Deny deja por escrito que este
  usuario no puede desplegar backend ni crearse credenciales. Nota que esto
  descarta Lambda@Edge: la composicion usa CloudFront Functions, que son un
  servicio distinto y no caen bajo `lambda:*`.

> Editar el JSON **no cambia nada en AWS**. Hay que publicar una version nueva
> de la policy (ver abajo); si no, el deploy falla con `AccessDenied` sobre la
> accion que se acaba de agregar.

## Reproducibilidad

```bash
export AWS_PROFILE=<admin-profile>
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"
REPO="salo368/Software-Inge-frontend"

# 1) Crear policy
aws iam create-policy \
  --policy-name CdtsFrontendDeploy \
  --policy-document file://scripts/iam/frontend-deploy-policy.json

POLICY_ARN=$(aws iam list-policies --scope Local \
  --query "Policies[?PolicyName=='CdtsFrontendDeploy'].Arn | [0]" --output text)

# 2) Crear usuarios y adjuntar la policy
for stage in dev pro; do
  user="github-actions-${stage}-frontend-deployer"
  aws iam create-user --user-name "$user" --path /githubactions/ \
    --tags Key=Project,Value=cdts Key=Stage,Value=$stage Key=Component,Value=frontend
  aws iam attach-user-policy --user-name "$user" --policy-arn "$POLICY_ARN"
done

# 3) Generar access keys y cargarlas como GitHub environment secrets
for stage in dev pro; do
  user="github-actions-${stage}-frontend-deployer"
  OUT=$(aws iam create-access-key --user-name "$user" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  KEY_ID=$(printf '%s' "$OUT" | awk '{print $1}')
  SECRET=$(printf '%s' "$OUT" | awk '{print $2}')
  printf '%s' "$KEY_ID" | gh secret set AWS_ACCESS_KEY_ID     --env "$stage" -R "$REPO"
  printf '%s' "$SECRET" | gh secret set AWS_SECRET_ACCESS_KEY --env "$stage" -R "$REPO"
  unset OUT KEY_ID SECRET
done

# 4) Variable de region (repo-level)
gh variable set AWS_REGION -R "$REPO" -b "us-east-1"
```

## Actualizar la policy

Despues de editar el JSON hay que publicar una version nueva y dejarla default:

```bash
aws iam create-policy-version \
  --policy-arn arn:aws:iam::658548982073:policy/CdtsFrontendDeploy \
  --policy-document file://scripts/iam/frontend-deploy-policy.json \
  --set-as-default
```

IAM guarda maximo 5 versiones: si falla por ese limite, borrar la mas vieja con
`aws iam delete-policy-version --version-id <vN>`.

## Rotacion de credenciales

AWS recomienda rotar access keys cada 90 dias:

```bash
STAGE=dev  # o pro
user="github-actions-${STAGE}-frontend-deployer"

OUT=$(aws iam create-access-key --user-name "$user" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
printf '%s' "$OUT" | awk '{print $1}' | gh secret set AWS_ACCESS_KEY_ID     --env "$STAGE" -R "$REPO"
printf '%s' "$OUT" | awk '{print $2}' | gh secret set AWS_SECRET_ACCESS_KEY --env "$STAGE" -R "$REPO"
unset OUT

# Verificar que el proximo deploy pasa, y recien ahi borrar la vieja:
#   aws iam list-access-keys --user-name "$user"
#   aws iam delete-access-key --user-name "$user" --access-key-id <OLD_ID>
```
