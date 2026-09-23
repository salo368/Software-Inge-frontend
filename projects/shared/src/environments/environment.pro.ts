// PROD. Fill each URL with the HttpApiUrl output of the matching cdts-pro-<service>
// stack once Actions has run the first PRO deploy for that block.
export const environment = {
  stage: 'pro' as const,
  authApiUrl: 'https://yaf407aj6h.execute-api.us-east-1.amazonaws.com',
  banksApiUrl: 'https://w1cw4wuh6f.execute-api.us-east-1.amazonaws.com',
  filesApiUrl: 'https://ka9r8sqof3.execute-api.us-east-1.amazonaws.com',
  formsApiUrl: 'https://2xk5tgytd5.execute-api.us-east-1.amazonaws.com',
  processesApiUrl: 'https://5ia3bf6rpe.execute-api.us-east-1.amazonaws.com',
  // signaturesApiUrl intentionally omitted from shared. See the dev env
  // for the rationale (browser must not talk to the signatures API).
};
