// STAGING. Copy of dev pointing at the cdts-staging-<service> stacks. Each URL
// is the HttpApiUrl output of the matching stack; update it in the same PR if a
// stack is ever recreated (sls remove + deploy changes the API id).
export const environment = {
  stage: 'staging' as const,
  authApiUrl: 'https://ejctduyvrh.execute-api.us-east-1.amazonaws.com',
  banksApiUrl: 'https://510cads3k3.execute-api.us-east-1.amazonaws.com',
  filesApiUrl: 'https://baa5v46yi0.execute-api.us-east-1.amazonaws.com',
  formsApiUrl: 'https://l5630m0078.execute-api.us-east-1.amazonaws.com',
  processesApiUrl: 'https://vt35i4tnwb.execute-api.us-east-1.amazonaws.com',
  paymentsApiUrl: 'https://sgzwzwllx5.execute-api.us-east-1.amazonaws.com',
  // Read-only from the portal (see the dev env for the rationale).
  signaturesApiUrl: 'https://zmbc5s5woj.execute-api.us-east-1.amazonaws.com',
};
