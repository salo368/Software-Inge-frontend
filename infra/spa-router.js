// CloudFront viewer-request function. Each block ships its own index.html, so
// a deep link like /portal/process/42 has to resolve to that block's index and
// not to another one's.
//
// The prefixes below must stay in sync with the CacheBehaviors in
// serverless.yml: a path that this function assigns to a block but CloudFront
// routes to a different origin would 403.
var BLOCK_PREFIXES = ['/portal/', '/sign/'];

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  for (var i = 0; i < BLOCK_PREFIXES.length; i++) {
    var prefix = BLOCK_PREFIXES[i];
    var bare = prefix.slice(0, -1);

    // `/portal` must become `/portal/`, otherwise the browser resolves the
    // block's relative asset paths against the root block.
    if (uri === bare) {
      return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: { location: { value: prefix } },
      };
    }

    if (uri.indexOf(prefix) === 0) {
      // Extensionless paths are Angular routes; real assets pass through.
      if (!/\.[a-zA-Z0-9]+$/.test(uri)) {
        request.uri = prefix + 'index.html';
      }
      return request;
    }
  }

  if (!/\.[a-zA-Z0-9]+$/.test(uri)) {
    request.uri = '/index.html';
  }
  return request;
}
