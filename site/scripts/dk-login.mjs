#!/usr/bin/env node
/**
 * Open a real Chromium window so you can log into DraftKings, then save cookies locally.
 *
 * Usage:
 *   npm run dk:login
 *
 * Cookies are written to site/.dk-cookies.json and DK_COOKIE in site/.env.local (both gitignored).
 * Do NOT paste cookies into chat or commit them.
 */

import readline from 'readline';
import { chromium } from 'playwright';
import {
  cookiesToHeader,
  DK_COOKIE_FILE,
  ENV_LOCAL_FILE,
  saveDkCookies,
} from './dk-cookie-utils.mjs';

const WC_URL = 'https://sportsbook.draftkings.com/leagues/soccer/fifa-world-cup';
const TEST_API_URL =
  'https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/209533?format=json';

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function testInBrowser(page, url) {
  return page.evaluate(async (target) => {
    const res = await fetch(target, { credentials: 'include' });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {}
    return {
      status: res.status,
      preview: text.slice(0, 160),
      eventCount: parsed?.eventGroup?.events?.length ?? null,
    };
  }, url);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`
DraftKings login helper
-----------------------
1. A Chromium window will open to the World Cup page.
2. Log in (and complete any location checks) in that window.
3. Navigate until you see real match odds if needed.
4. Return here and press Enter to save cookies.

Saved to:
  ${DK_COOKIE_FILE}
  ${ENV_LOCAL_FILE} (DK_COOKIE=...)
`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();

  await page.goto(WC_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  await waitForEnter('\nPress Enter after you are logged in… ');

  const cookies = await context.cookies();
  const cookieHeader = cookiesToHeader(cookies);

  if (!cookieHeader) {
    // eslint-disable-next-line no-console
    console.error('No DraftKings cookies found. Did you finish logging in?');
    await browser.close();
    process.exit(1);
  }

  const browserTest = await testInBrowser(page, TEST_API_URL);
  // eslint-disable-next-line no-console
  console.log('\nIn-browser API test:', browserTest);

  saveDkCookies({ cookieHeader, cookies });
  // eslint-disable-next-line no-console
  console.log(`\nSaved ${cookies.length} cookies (${cookieHeader.length} chars in DK_COOKIE).`);
  // eslint-disable-next-line no-console
  console.log('Run: npm run dk:test-fetch');

  await browser.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
