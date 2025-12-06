// Simple Express server to serve the CRA build with per-route OG meta tags.
// It loads build/index.html once, then replaces __OG_TITLE__ and
// __OG_DESCRIPTION__ placeholders based on the request path.

const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const buildDir = path.join(__dirname, 'build');
const indexPath = path.join(buildDir, 'index.html');

// Route meta configuration (per-path OG)
// See site/routeMeta.json – kept outside of src so it can be loaded directly by Node.
// Keys are URL paths (as seen in react-router), plus '*' as a fallback and
// prefix-style entries like '/team/' to cover dynamic routes.
// Example:
// {
//   "/home/": { "ogTitle": "The Hwang Dynasty", "ogDescription": "" },
//   "/Scores/Week": { "ogTitle": "Hwang Dynasty Scores", "ogDescription": "" },
//   ...
// }
// eslint-disable-next-line global-require, import/no-dynamic-require
const routeMeta = require('./routeMeta.json');

function getMetaForPath(urlPath) {
  if (!routeMeta || typeof routeMeta !== 'object') {
    return {
      ogTitle: 'The Hwang Dynasty',
      ogDescription: ''
    };
  }

  // Exact match first
  if (Object.prototype.hasOwnProperty.call(routeMeta, urlPath)) {
    return routeMeta[urlPath];
  }

  // Prefix match for dynamic routes (e.g., "/team/:id")
  // Any key that ends with "/" and is a prefix of urlPath qualifies.
  const prefixKeys = Object.keys(routeMeta).filter((key) => key !== '*' && key.endsWith('/'));
  for (let i = 0; i < prefixKeys.length; i += 1) {
    const key = prefixKeys[i];
    if (urlPath.startsWith(key)) {
      return routeMeta[key];
    }
  }

  // Fallback
  if (Object.prototype.hasOwnProperty.call(routeMeta, '*')) {
    return routeMeta['*'];
  }

  return {
    ogTitle: 'The Hwang Dynasty',
    ogDescription: ''
  };
}

function renderIndexForPath(urlPath) {
  let baseHtml = '';
  try {
    baseHtml = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to read build/index.html at request time:', e.message);
    return '';
  }
  const { ogTitle, ogDescription, ogImage } = getMetaForPath(urlPath);

  const safeTitle = ogTitle != null ? String(ogTitle) : '';
  const safeDescription = ogDescription != null ? String(ogDescription) : '';
  const safeImage = ogImage != null ? String(ogImage) : '/logo.png';

  return baseHtml
    .replace(/__OG_TITLE__/g, safeTitle)
    .replace(/__OG_DESCRIPTION__/g, safeDescription)
    .replace(/__OG_IMAGE__/g, safeImage);
}

// Serve static assets from the CRA build folder, but do NOT auto-serve index.html.
// index.html is always sent through the handler below so we can inject OG meta.
app.use(express.static(buildDir, { index: false }));

// For any other GET request (i.e., SPA routes), serve index.html with OG placeholders filled in
app.get('*', (req, res) => {
  const html = renderIndexForPath(req.path);
  if (!html) {
    res.status(500).send('Server not initialized. Please build the app first.');
    return;
  }
  res.send(html);
});

const port = process.env.PORT || 3000;
// eslint-disable-next-line no-console
app.listen(port, () => console.log(`SSR meta server listening on port ${port}`));


