'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const vm = require('node:vm');

const { spaRouter } = require('./function-code');

// The edge function is plain source text, so evaluate it the way CloudFront
// does rather than importing it.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${spaRouter()}; this.handler = handler;`, sandbox);

const call = (uri) => sandbox.handler({ request: { uri } });
const route = (uri) => call(uri).uri;

test('root block serves its own index for deep links', () => {
  assert.equal(route('/'), '/index.html');
  assert.equal(route('/docs'), '/index.html');
  assert.equal(route('/docs/use-cases'), '/index.html');
});

test('each block resolves to its own index', () => {
  assert.equal(route('/portal/'), '/portal/index.html');
  assert.equal(route('/portal/login'), '/portal/index.html');
  assert.equal(route('/portal/process/42'), '/portal/index.html');
  assert.equal(route('/sign/9f3c1a2b'), '/sign/index.html');
});

test('a block root without a trailing slash redirects', () => {
  for (const [uri, target] of [
    ['/portal', '/portal/'],
    ['/sign', '/sign/'],
  ]) {
    const res = call(uri);
    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.location.value, target);
  }
});

test('assets pass through untouched', () => {
  assert.equal(route('/main-ABC123.js'), '/main-ABC123.js');
  assert.equal(route('/portal/styles-XYZ.css'), '/portal/styles-XYZ.css');
  assert.equal(route('/sign/assets/pdf.worker.min.mjs'), '/sign/assets/pdf.worker.min.mjs');
  assert.equal(route('/favicon.ico'), '/favicon.ico');
  assert.equal(route('/assets/docs/parex.json'), '/assets/docs/parex.json');
});

test('a prefix is not confused with a root route that merely starts the same', () => {
  // CloudFront routes /signals to the default origin, so this function must
  // not hand it to the signing block or it would 403.
  assert.equal(route('/signals'), '/index.html');
  assert.equal(route('/portal-status'), '/index.html');
});
