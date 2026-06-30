#!/usr/bin/env node
/**
 * Quick test: does Node fetch work with your saved DK cookies?
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDkCookieHeader } from './dk-cookie-utils.mjs';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_LOCAL = path.join(SITE_DIR, '.env.local');

// Load .env.local (same pattern as chat-dev-server.js)
try {
  const envContent = fs.readFileSync(ENV_LOCAL, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '').replace(/\\"/g, '"');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch (_) {}

const cookie = loadDkCookieHeader();
const url =
  'https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/209533?format=json';

if (!cookie) {
  // eslint-disable-next-line no-console
  console.error('No DK_COOKIE found. Run: npm run dk:login');
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(`Testing with cookie (${cookie.length} chars)…\n${url}\n`);

const res = await fetch(url, {
  headers: {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://sportsbook.draftkings.com/leagues/soccer/fifa-world-cup',
    Origin: 'https://sportsbook.draftkings.com',
    Cookie: cookie,
  },
});

const text = await res.text();
// eslint-disable-next-line no-console
console.log('Status:', res.status);

if (res.ok) {
  const data = JSON.parse(text);
  const events = data?.eventGroup?.events ?? [];
  // eslint-disable-next-line no-console
  console.log('Events:', events.length);
  events.slice(0, 5).forEach((e) => console.log(' -', e.name));
} else {
  // eslint-disable-next-line no-console
  console.log(text.slice(0, 300));
}
