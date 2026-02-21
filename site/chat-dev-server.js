// Standalone dev API server for local development.
// Handles POST /api/chat and proxies to Gemini.
// Run alongside `npm start` (CRA dev server) using: npm run api --prefix site
// CRA forwards unknown requests here via the "proxy" field in package.json.

const fs = require('fs');
const path = require('path');
const http = require('http');

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

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }

      const { messages, systemPrompt } = parsed || {};
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Invalid messages' }));
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }));
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
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          }
        );

        if (!geminiRes.ok) {
          const err = await geminiRes.json().catch(() => ({}));
          res.writeHead(geminiRes.status);
          return res.end(JSON.stringify({ error: 'Gemini API error', details: err }));
        }

        const data = await geminiRes.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        res.writeHead(200);
        return res.end(JSON.stringify({ message: text }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// eslint-disable-next-line no-console
server.listen(PORT, () => console.log(`Chat dev server running on http://localhost:${PORT}`));
