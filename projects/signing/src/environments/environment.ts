// The signing block talks to exactly one API. That is the whole point: it can
// sign any document the backend hands it, with no knowledge of the product.
//
// signaturesApiUrl points at the HttpApiUrl output of the cdts-dev-signatures
// CloudFormation stack. HTTP API Gateway URLs are stable across deploys as
// long as the API resource itself is not destroyed, but a destructive schema
// migration OR sls remove/redeploy WILL change the id and this file MUST be
// updated in the same PR that lands the recreation.
//
// To discover the current URL:
//
//   aws cloudformation describe-stacks \
//     --stack-name cdts-dev-signatures \
//     --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" \
//     --output text
//
// If the value drifts, the signing SPA will render "Enlace no valido" for
// every ceremony (the GET call fails from the wrong origin).
export const environment = {
  stage: 'dev' as const,
  signaturesApiUrl: 'https://514ou9he5b.execute-api.us-east-1.amazonaws.com',
};
