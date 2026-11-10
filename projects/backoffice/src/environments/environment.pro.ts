// PROD. HttpApiUrl of the cdts-pro-admin-auth stack.
export const environment = {
  stage: 'pro' as const,
  // TODO(admin_auth): `cdts-pro-admin-auth` todavia no esta desplegado. Reemplazar
  // con su HttpApiUrl tras el primer deploy del servicio a pro.
  adminAuthApiUrl: 'https://PENDING-FIRST-DEPLOY.execute-api.us-east-1.amazonaws.com',
};
