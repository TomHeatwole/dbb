// CRA src/setupProxy.js — used instead of the package.json "proxy" field.
// Only forward /api to the local API so SPA routes like /auth/callback are
// never swallowed. When port 3001 is down, return JSON instead of the
// webpack-dev-server "Proxy error: ..." plaintext that breaks res.json().

const { createProxyMiddleware } = require('http-proxy-middleware');

const API_TARGET = 'http://127.0.0.1:3001';

module.exports = function setupProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: API_TARGET,
      changeOrigin: true,
      onError(err, req, res) {
        if (res.headersSent) return;
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Local API is not running. Start it with npm run api --prefix site',
          details: err.message,
        }));
      },
    })
  );
};
