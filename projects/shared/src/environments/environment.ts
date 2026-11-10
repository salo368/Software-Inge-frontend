// Default (dev). Each backend service exposes its own API Gateway HttpApi so
// each domain has its own base URL. Each value is the `HttpApiUrl` output of
// the matching `cdts-dev-<service>` stack:
//
//   aws cloudformation describe-stacks --stack-name cdts-dev-<service> \
//     --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text
//
// Update it in the same PR if a stack is ever recreated (sls remove + deploy
// changes the API id).
export const environment = {
  stage: 'dev' as const,
  authApiUrl: 'https://7sdsmzal74.execute-api.us-east-1.amazonaws.com',
  banksApiUrl: 'https://elrpxpxr10.execute-api.us-east-1.amazonaws.com',
  filesApiUrl: 'https://vscpzi63i5.execute-api.us-east-1.amazonaws.com',
  formsApiUrl: 'https://aq75mimnb5.execute-api.us-east-1.amazonaws.com',
  processesApiUrl: 'https://qtpm8tknoi.execute-api.us-east-1.amazonaws.com',
  // TODO(payments): `cdts-dev-payments` todavía no está desplegado. Reemplazar
  // con su HttpApiUrl tras el primer deploy del servicio a dev.
  paymentsApiUrl: 'https://PENDING-FIRST-DEPLOY.execute-api.us-east-1.amazonaws.com',
  // Read-only use from the portal: `GET /signatures/get-signature` to show
  // whether the investment-order signature ended SIGNED or FAILED. The
  // signing block has its own env with the same URL and drives the ceremony.
  signaturesApiUrl: 'https://514ou9he5b.execute-api.us-east-1.amazonaws.com',
};
