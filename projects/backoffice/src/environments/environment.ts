// Backoffice block: internal admin tools. It authenticates against the
// `admin_auth` service (separate accounts and tokens from the investors').
//
// adminAuthApiUrl = HttpApiUrl output of the cdts-<stage>-admin-auth stack:
//
//   aws cloudformation describe-stacks --stack-name cdts-dev-admin-auth \
//     --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text
export const environment = {
  stage: 'dev' as const,
  // TODO(admin_auth): `cdts-dev-admin-auth` todavia no esta desplegado. Reemplazar
  // con su HttpApiUrl tras el primer deploy del servicio a dev.
  adminAuthApiUrl: 'https://PENDING-FIRST-DEPLOY.execute-api.us-east-1.amazonaws.com',
};
