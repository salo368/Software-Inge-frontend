// The signing block talks to exactly one API. That is the whole point: it can
// sign any document the backend hands it, with no knowledge of the product.
export const environment = {
  stage: 'dev' as const,
  signaturesApiUrl: 'https://6yif8zgrr4.execute-api.us-east-1.amazonaws.com',
};
