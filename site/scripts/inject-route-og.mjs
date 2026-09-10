/**
 * Bake per-route Open Graph tags into the CRA build.
 *
 * Facebook / iMessage / Slack read the raw HTML and never run React, so each
 * share URL needs its own index.html. We do not route those pages through
 * api/render.js — that function 500s on Vercel and took /fredduel down.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const templatePath = path.join(buildDir, 'index.html');
const metaPath = path.join(root, 'routeMeta.json');
const spaCopyPath = path.join(root, 'api', '_spa-template.html');

const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://www.hwangdynasty.com').replace(/\/+$/, '');
const DEFAULT_TITLE = 'The Hwang Dynasty';
const DEFAULT_DESCRIPTION = 'Because Sleeper is too lazy for BestBall in browser';
const DEFAULT_IMAGE = '/logo.png';

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function absoluteUrl(origin, maybePath) {
  if (!maybePath) return `${origin}/`;
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  const pathPart = maybePath.startsWith('/') ? maybePath : `/${maybePath}`;
  return `${origin}${pathPart}`;
}

function canonicalUrl(origin, routePath) {
  if (!routePath || routePath === '*') return `${origin}/`;
  if (routePath === '/') return `${origin}/`;
  return `${origin}${routePath}`;
}

function imageType(imagePath) {
  const lower = String(imagePath).toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function stripOgTags(html) {
  return html
    .replace(/<meta[^>]+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta[^>]+name=["']twitter:[^"']+["'][^>]*>\s*/gi, '')
    .replace(/<meta[^>]+property=["']og:[^"']+["'][^>]*>\s*/gi, '')
    .replace(/<title>[^<]*<\/title>/i, '');
}

function injectOg(html, { title, description, imagePath, routePath }) {
  const ogTitle = title || DEFAULT_TITLE;
  const ogDescription = description || DEFAULT_DESCRIPTION;
  const ogImage = absoluteUrl(SITE_ORIGIN, imagePath || DEFAULT_IMAGE);
  const ogUrl = canonicalUrl(SITE_ORIGIN, routePath);
  const type = imageType(imagePath || DEFAULT_IMAGE);

  const block = [
    `<title>${escapeAttr(ogTitle)}</title>`,
    `<meta name="description" content="${escapeAttr(ogDescription)}">`,
    `<meta property="og:title" content="${escapeAttr(ogTitle)}">`,
    `<meta property="og:description" content="${escapeAttr(ogDescription)}">`,
    `<meta property="og:image" content="${escapeAttr(ogImage)}">`,
    `<meta property="og:image:secure_url" content="${escapeAttr(ogImage)}">`,
    `<meta property="og:image:type" content="${type}">`,
    `<meta property="og:url" content="${escapeAttr(ogUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeAttr(DEFAULT_TITLE)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(ogTitle)}">`,
    `<meta name="twitter:description" content="${escapeAttr(ogDescription)}">`,
    `<meta name="twitter:image" content="${escapeAttr(ogImage)}">`,
  ].join('\n  ');

  const next = stripOgTags(html);
  if (!next.includes('</head>')) {
    throw new Error('Built HTML is missing </head>');
  }
  return next.replace('</head>', `  ${block}\n</head>`);
}

function htmlPathForRoute(routePath) {
  if (!routePath || routePath === '*' || routePath === '/') {
    return path.join(buildDir, 'index.html');
  }
  const trimmed = routePath.replace(/\/+$/, '');
  return path.join(buildDir, trimmed.slice(1), 'index.html');
}

if (!fs.existsSync(templatePath)) {
  throw new Error(`SPA template missing: ${templatePath}`);
}
if (!fs.existsSync(metaPath)) {
  throw new Error(`routeMeta.json missing: ${metaPath}`);
}

const template = fs.readFileSync(templatePath, 'utf8');
const routeMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

fs.mkdirSync(path.dirname(spaCopyPath), { recursive: true });
fs.writeFileSync(spaCopyPath, template);
console.log(`Copied build/index.html -> ${path.relative(root, spaCopyPath)}`);

const written = [];
for (const [routePath, meta] of Object.entries(routeMeta)) {
  if (!meta || typeof meta !== 'object') continue;

  const dest = htmlPathForRoute(routePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    injectOg(template, {
      title: meta.ogTitle,
      description: meta.ogDescription,
      imagePath: meta.ogImage,
      routePath,
    }),
  );
  written.push(`${routePath} -> ${path.relative(buildDir, dest)}`);
}

console.log(`Injected OG tags for ${written.length} routes:`);
for (const line of written) {
  console.log(`  ${line}`);
}
