// Standalone dev API server for local development.
// Delegates POST /api/chat to api/chat.js (the same handler used by Vercel).
// Run alongside `npm start` using: npm run api --prefix site

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

// Load .env.local (best-effort)
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch (_) {}

const PORT = 3001;

// Shim Express-style res methods onto Node's ServerResponse so api/chat.js works unchanged
function shimResponse(res) {
  res.status = function(code) { this.statusCode = code; return this; };
  res.json   = function(data) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(data));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  shimResponse(res);

  const pathname = (req.url || '').split('?')[0];

  const postHandlers = {
    '/api/chat': 'chat',
    '/api/search': 'search',
  };

  const getHandlers = {
    '/api/fanduel-sop': 'fanduel-sop',
    '/api/draftkings-goal-method': 'draftkings-goal-method',
    '/api/kalshi-sop': 'kalshi-sop',
  };

  const handlerName =
  req.method === 'POST' ? postHandlers[pathname]
    : req.method === 'GET' ? getHandlers[pathname]
      : null;

  if (handlerName && (req.method === 'GET' || req.method === 'POST')) {
    const runHandler = async (body) => {
      try {
        req.body = body;
        const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        req.query = Object.fromEntries(parsed.searchParams);
        const { default: handler } = await import(`./api/${handlerName}.mjs?v=${Date.now()}`);
        await handler(req, res);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Handler error:', err);
        res.status(500).json({ error: err.message });
      }
    };

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          await runHandler(JSON.parse(body));
        } catch {
          res.status(400).json({ error: 'Invalid JSON' });
        }
      });
      return;
    }

    await runHandler(undefined);
    return;
  }

  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-console
server.listen(PORT, () => console.log(`Chat dev server running on http://localhost:${PORT}`));
