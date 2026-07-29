#!/usr/bin/env node
/**
 * Bet365 SOP probe — reverse-engineering spike for Next Goal / No Goal odds.
 *
 * Run from site/:  node scripts/bet365-probe.mjs [--headed]
 */

import { chromium } from 'playwright';

const HOST = process.env.B365_HOST || 'www.nj.bet365.com';
const HEADED = process.argv.includes('--headed');
const MATCH_PD = process.env.B365_MATCH_PD || '#/AC/B1/C1/D8/E197242115/F3/I1/';

function parseSections(text) {
  return text.split('|').filter(Boolean);
}

function prop(section, key) {
  const m = section.match(new RegExp(`(?:^|;)${key}=([^;]*)`));
  return m?.[1] ?? null;
}

function parseLeftnavFixtures(text) {
  const fixtures = new Map();
  for (const section of parseSections(text)) {
    if (!section.startsWith('EV;')) continue;
    const name = prop(section, 'NA');
    const pd = prop(section, 'PD');
    if (!name || !pd || !/\sv\s/i.test(name)) continue;
    const eventId = pd.match(/E(\d+)/)?.[1] ?? null;
    fixtures.set(name, { name, pd, eventId });
  }
  return [...fixtures.values()];
}

function fractionalToAmerican(frac) {
  if (!frac || !/^\d+\/\d+$/.test(frac)) return null;
  const [num, den] = frac.split('/').map(Number);
  if (!num || !den) return null;
  if (num >= den) return Math.round((num / den) * 100);
  return Math.round(-(den / num) * 100);
}

function extractGoalMarkets(pipeText) {
  const sections = parseSections(pipeText);
  const markets = [];
  for (const section of sections) {
    if (!section.startsWith('MA;')) continue;
    const name = prop(section, 'NA');
    if (!name || !/goal|method/i.test(name)) continue;
    markets.push({
      name,
      oddsFrac: prop(section, 'OD'),
      american: fractionalToAmerican(prop(section, 'OD')),
      fixtureId: prop(section, 'FI'),
    });
  }
  return markets;
}

function findNextGoalQuotes(pipeText) {
  const low = pipeText.toLowerCase();
  const terms = ['next goal', 'no goal', 'goal method', 'method of'];
  const hits = [];
  for (const term of terms) {
    let idx = 0;
    while ((idx = low.indexOf(term, idx)) >= 0) {
      hits.push(pipeText.slice(Math.max(0, idx - 80), idx + 280));
      idx += term.length;
    }
  }
  return hits;
}

async function bootstrapSession(page) {
  await page.goto(`https://${HOST}/`, { waitUntil: 'networkidle', timeout: 120_000 });
  try {
    await page.getByText('Accept All', { exact: true }).click({ timeout: 8000 });
  } catch {
    // cookie banner may already be dismissed
  }
  await page.waitForTimeout(1500);
}

async function inPageFetch(page, path, xnst) {
  return page.evaluate(
    async ({ path, xnst }) => {
      const headers = { 'X-Request-Id': crypto.randomUUID() };
      if (xnst) headers['X-Net-Sync-Term'] = xnst;
      const res = await fetch(path, { credentials: 'include', headers });
      return { status: res.status, text: await res.text() };
    },
    { path, xnst },
  );
}

async function main() {
  console.log(`Bet365 probe → https://${HOST}/ (${HEADED ? 'headed' : 'headless'})`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    geolocation: { latitude: 40.7128, longitude: -74.0060 },
    permissions: ['geolocation'],
    viewport: { width: 1400, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  let xnst = null;
  page.on('request', (req) => {
    const h = req.headers()['x-net-sync-term'];
    if (h) xnst = h;
  });

  await bootstrapSession(page);

  const leftnav = await inPageFetch(
    page,
    '/leftnavcontentapi/allsportsmenu?lid=32&zid=0&pd=%23AL%23R%5E1%23&cid=198&cgid=3&ctid=198',
    xnst,
  );
  console.log(`\nleftnav: HTTP ${leftnav.status}, ${leftnav.text.length} bytes, XNST=${xnst ? 'yes' : 'no'}`);

  const fixtures = parseLeftnavFixtures(leftnav.text);
  console.log(`fixtures with " v ": ${fixtures.length}`);
  for (const f of fixtures.slice(0, 12)) {
    console.log(`  ${f.name}  E${f.eventId ?? '?'}  PD=${f.pd}`);
  }

  const pods = await inPageFetch(
    page,
    '/pullpodapi/gethomepagepods?lid=32&zid=0&pd=%23HO%23COL1%23&cid=198&cstid=1&tcstid=1&crid=54&cgid=3&ctid=198&csid=3',
    xnst,
  );
  console.log(`\nhomepage pods: HTTP ${pods.status}, ${pods.text.length} bytes`);
  const podGoalMarkets = extractGoalMarkets(pods.text);
  console.log(`goal-related MA sections in pods: ${podGoalMarkets.length}`);
  for (const m of podGoalMarkets.slice(0, 8)) {
    console.log(`  ${m.name}  ${m.oddsFrac ?? '—'}  (${m.american ?? '—'})`);
  }

  console.log(`\nNavigating to match ${MATCH_PD} …`);
  await page.goto(`https://${HOST}/${MATCH_PD.replace('#', '#/')}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(HEADED ? 25_000 : 15_000);

  const bodyLen = (await page.locator('body').innerText()).length;
  const marketNodes = await page.locator('[class*="Market"]').count();
  console.log(`match page: body text ${bodyLen} chars, Market* nodes ${marketNodes}`);
  if (bodyLen < 2000) {
    console.log('  SPA likely stuck on spinner — coupon API will probably be empty');
  }

  const couponPath = `/matchbettingcontentapi/coupon?lid=32&zid=0&pd=${encodeURIComponent(MATCH_PD)}&cid=198&cgid=3&ctid=198`;
  const coupon = await inPageFetch(page, couponPath, xnst);
  console.log(`\ncoupon: HTTP ${coupon.status}, ${coupon.text.length} bytes`);
  const couponHits = findNextGoalQuotes(coupon.text);
  if (couponHits.length) {
    for (const hit of couponHits) console.log('  ', hit.replace(/\s+/g, ' ').slice(0, 200));
  } else {
    console.log('  (no Next Goal / No Goal / Goal Method strings in response)');
  }

  const couponGoalMarkets = extractGoalMarkets(coupon.text);
  if (couponGoalMarkets.length) {
    console.log('  goal MA markets:', couponGoalMarkets.map((m) => m.name).join(', '));
  }

  console.log('\n--- next steps ---');
  console.log('1. Run with --headed on a machine where nj.bet365.com loads fully in Chrome');
  console.log('2. DevTools → Network → matchbettingcontentapi/coupon with non-empty body');
  console.log('3. Copy X-Net-Sync-Term + Cookie; note PD/F-tab for Goals market');
  console.log('4. If coupon stays empty, intercept wss://*.365lpodds.com/zap subscription frames');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
