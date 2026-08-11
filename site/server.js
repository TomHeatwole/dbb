// Simple Express server for local development that delegates HTML rendering
// to the same renderer used by Vercel (api/render). This keeps local OG/meta
// behavior in sync with the Vercel deployment.

// Load .env.local for local development (best-effort)
try {
  const fs = require('fs');
  const envContent = fs.readFileSync(require('path').join(__dirname, '.env.local'), 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch (_) {}

const path = require('path');
const express = require('express');

// api/render.js is an ES module — must use dynamic import, not require()
async function main() {
  const { default: renderHandler } = await import('./api/render.js');

  const app = express();
  app.use(express.json());
  const buildDir = path.join(__dirname, 'build');

  // Serve static assets from the CRA build folder, but do NOT auto-serve index.html.
  app.use(express.static(buildDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
    },
  }));

  // Chat API — proxies to Gemini (mirrors api/chat.js for local dev)
  app.post('/api/chat', async (req, res) => {
    const { messages, systemPrompt } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages' });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const requestBody = { contents };
    if (systemPrompt) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
      );
      if (!geminiRes.ok) {
        const err = await geminiRes.json().catch(() => ({}));
        return res.status(geminiRes.status).json({ error: 'Gemini API error', details: err });
      }
      const data = await geminiRes.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({ message: text });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/fanduel-sop', async (req, res) => {
    try {
      const { default: handler } = await import('./api/fanduel-sop.mjs');
      return handler(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/draftkings-goal-method', async (req, res) => {
    try {
      const { default: handler } = await import('./api/draftkings-goal-method.mjs');
      return handler(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/kalshi-sop', async (req, res) => {
    try {
      const { default: handler } = await import('./api/kalshi-sop.mjs');
      return handler(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/db-hello', async (req, res) => {
    try {
      const { default: handler } = await import('./api/db-hello.mjs');
      return handler(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.all('/api/exchange', async (req, res) => {
    try {
      const { default: handler } = await import('./api/exchange.mjs');
      return handler(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/me', async (req, res) => {
    try {
      const { default: handler } = await import('./api/me.mjs');
      return handler(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/onboard', async (req, res) => {
    try {
      const { default: handler } = await import('./api/onboard.mjs');
      return handler(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Delegate all other GET requests (SPA routes) to the shared renderer.
  app.get('*', (req, res) => {
    return renderHandler(req, res);
  });

  const port = process.env.PORT || 3000;
  // eslint-disable-next-line no-console
  app.listen(port, () => {});
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});


