// Simple Express server for local development that delegates HTML rendering
// to the same renderer used by Vercel (api/render). This keeps local OG/meta
// behavior in sync with the Vercel deployment.

const path = require('path');
const express = require('express');
const renderHandler = require('./api/render');

const app = express();
const buildDir = path.join(__dirname, 'build');

// Serve static assets from the CRA build folder, but do NOT auto-serve index.html.
app.use(express.static(buildDir, { index: false }));

// Delegate all other GET requests (SPA routes) to the shared renderer.
app.get('*', (req, res) => {
  return renderHandler(req, res);
});

const port = process.env.PORT || 3000;
// eslint-disable-next-line no-console
app.listen(port, () => console.log(`Local server listening on http://localhost:${port}`));


