#!/usr/bin/env node
/**
 * Quick test: Nash controldata markets API (+ optional saved cookies).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDkCookieHeader } from './dk-cookie-utils.mjs';
import { fetchWorldCupGoalMethodOdds } from '../api/draftkings-goal-method.mjs';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_LOCAL = path.join(SITE_DIR, '.env.local');

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

const eventId = process.argv[2] || '34326921';
const subId = process.argv[3] || '6541';
const filter = `$filter=eventId eq '${eventId}' AND clientMetadata/subCategoryId eq '${subId}' AND tags/all(t: t ne 'SportcastBetBuilder')`;
const url =
  'https://sportsbook-nash.draftkings.com/sites/US-NY-SB/api/sportscontent/controldata/event/eventSubcategory/v1/markets?' +
  new URLSearchParams({
    isBatchable: 'false',
    templateVars: `${eventId},${subId}`,
    marketsQuery: filter,
    entity: 'markets',
  });

const cookie = loadDkCookieHeader();
// eslint-disable-next-line no-console
console.log(`Direct markets test (cookie: ${cookie ? 'yes' : 'no'})\n${url}\n`);

const res = await fetch(url, {
  headers: {
    Accept: 'application/json',
    Origin: 'https://sportsbook.draftkings.com',
    Referer: `https://sportsbook.draftkings.com/event/ivory-coast-vs-norway/${eventId}`,
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'x-client-name': 'web',
    'x-client-page': 'event',
    'x-client-version': '1.14.0',
    'x-pe-ep': 'SB',
    'x-pe-loc': 'US-NY',
    ...(cookie ? { Cookie: cookie } : {}),
  },
});

const text = await res.text();
// eslint-disable-next-line no-console
console.log('Status:', res.status);

if (res.ok) {
  const data = JSON.parse(text);
  // eslint-disable-next-line no-console
  console.log('Market:', data.markets?.[0]?.name);
  for (const s of data.selections ?? []) {
    // eslint-disable-next-line no-console
    console.log(`  ${s.label}: ${s.displayOdds?.american}`);
  }
} else {
  // eslint-disable-next-line no-console
  console.log(text.slice(0, 300));
}

// eslint-disable-next-line no-console
console.log('\n--- Full scraper ---');
const all = await fetchWorldCupGoalMethodOdds();
// eslint-disable-next-line no-console
console.log('games:', all.games.length);
const withGoal = all.games.filter((g) => g.goalTypes);
// eslint-disable-next-line no-console
console.log('with DK goal types:', withGoal.length);
if (withGoal[0]) {
  // eslint-disable-next-line no-console
  console.log('sample:', withGoal[0].name, withGoal[0].goalTypes);
}
