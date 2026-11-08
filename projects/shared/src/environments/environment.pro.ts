// PROD. Each URL is the HttpApiUrl output of the matching cdts-pro-<service>
// stack.
export const environment = {
  stage: 'pro' as const,
  authApiUrl: 'https://yaf407aj6h.execute-api.us-east-1.amazonaws.com',
  banksApiUrl: 'https://w1cw4wuh6f.execute-api.us-east-1.amazonaws.com',
  filesApiUrl: 'https://ka9r8sqof3.execute-api.us-east-1.amazonaws.com',
  formsApiUrl: 'https://2xk5tgytd5.execute-api.us-east-1.amazonaws.com',
  processesApiUrl: 'https://5ia3bf6rpe.execute-api.us-east-1.amazonaws.com',
  // TODO(payments): `cdts-pro-payments` todavía no está desplegado. Reemplazar
  // con su HttpApiUrl tras el primer deploy del servicio a pro.
  paymentsApiUrl: 'https://PENDING-FIRST-DEPLOY.execute-api.us-east-1.amazonaws.com',
  // Read-only from the portal (see the dev env for the rationale).
  signaturesApiUrl: 'https://rhrd2rhwed.execute-api.us-east-1.amazonaws.com',
};
