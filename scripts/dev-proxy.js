/**
 * Local stand-in for CloudFront: one origin for the three blocks, so they
 * share localStorage (the session) and cross-block links and `return_url`
 * work like in a deployed stage.
 *
 *   http://localhost:4300/        -> simulator (ng serve, :4200)
 *   http://localhost:4300/portal  -> portal    (ng serve, :4201)
 *   http://localhost:4300/sign    -> signing   (ng serve, :4202)
 *
 * Start the three dev servers first (`npm run start:blocks`), then this
 * (`npm run start:proxy`) and open http://localhost:4300. Reuses
 * `http-proxy-middleware`, which `@angular-devkit/build-angular` already ships.
 */
const http = require('node:http');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = Number(process.env.PROXY_PORT || 4300);

const proxy = (port) =>
  createProxyMiddleware({ target: `http://localhost:${port}`, changeOrigin: false, ws: true });

const portal = proxy(4201);
const signing = proxy(4202);
const simulator = proxy(4200);

const pick = (url) => (url.startsWith('/portal') ? portal : url.startsWith('/sign') ? signing : simulator);

const server = http.createServer((req, res) => pick(req.url)(req, res));
// Live reload websockets: each dev server serves its own under its base href.
server.on('upgrade', (req, socket, head) => pick(req.url).upgrade(req, socket, head));

server.listen(PORT, () => {
  console.log(`Dev proxy on http://localhost:${PORT}  (/ -> 4200, /portal -> 4201, /sign -> 4202)`);
});
