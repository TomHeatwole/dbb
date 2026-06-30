#!/usr/bin/env node
/**
 * Discover DraftKings World Cup event IDs via Nash pagedata (no cookies).
 * The league/home HTML shells are empty — this probes eventIds directly.
 *
 * Usage:
 *   npm run dk:discover-events
 *   npm run dk:discover-events -- --start 34322000 --end 34332000
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = path.join(SITE_DIR, 'api', 'dk-wc-event-map.json');
const WC_LEAGUE_ID = '209533';
const DK_PE_LOC = process.env.DK_PE_LOC || 'US-NY';
const NASH_BASE = `https://sportsbook-nash.draftkings.com/sites/US-${DK_PE_LOC}-SB/api`;

const DEFAULT_START = Number(process.env.DK_SCAN_START || 34322000);
const DEFAULT_END = Number(process.env.DK_SCAN_END || 34332000);
const CONCURRENCY = Number(process.env.DK_SCAN_CONCURRENCY || 20);

function parseArgs() {
  const args = process.argv.slice(2);
  let start = DEFAULT_START;
  let end = DEFAULT_END;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--start') start = Number(args[++i]);
    if (args[i] === '--end') end = Number(args[++i]);
  }
  return { start, end };
}

function nashHeaders() {
  return {
    Accept: 'application/json, */*',
    Origin: 'https://sportsbook.draftkings.com',
    Referer: 'https://sportsbook.draftkings.com/leagues/soccer/fifa-world-cup',
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'x-client-feature': 'cms',
    'x-client-name': 'web',
    'x-client-page': 'league',
    'x-client-version': '1.14.0',
    'x-pe-cn': 'web',
    'x-pe-cv': '1.14.0',
    'x-pe-ep': 'SB',
    'x-pe-loc': DK_PE_LOC,
  };
}

async function fetchEventMeta(eventId, retries = 2) {
  const url = `${NASH_BASE}/sportscontent/pagedata/event/v1/events?eventIds=${eventId}`;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { headers: nashHeaders() });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const event = (await res.json()).events?.[0];
      if (!event || String(event.leagueId) !== WC_LEAGUE_ID) return null;
      return {
        eventId: String(event.id),
        name: event.name,
        slug: event.seoIdentifier ?? null,
        openDate: event.startEventDate ?? null,
      };
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function scanRange(start, end) {
  const found = new Map();
  const total = end - start;
  let checked = 0;
  const started = Date.now();

  for (let base = start; base < end; base += CONCURRENCY) {
    const ids = Array.from({ length: Math.min(CONCURRENCY, end - base) }, (_, i) => base + i);
    const results = await Promise.all(ids.map((id) => fetchEventMeta(id)));
    for (const event of results) {
      if (event) found.set(event.eventId, event);
    }
    checked += ids.length;
    if (checked % 1000 === 0 || base + CONCURRENCY >= end) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      // eslint-disable-next-line no-console
      console.log(`scanned ${checked}/${total} (${elapsed}s) — WC events: ${found.size}`);
    }
  }

  return [...found.values()].sort((a, b) => {
    if (!a.openDate) return 1;
    if (!b.openDate) return -1;
    return new Date(a.openDate) - new Date(b.openDate);
  });
}

function saveMap(events) {
  const byId = new Map();
  try {
    for (const event of JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')).events ?? []) {
      byId.set(event.eventId, event);
    }
  } catch (_) {}

  for (const event of events) {
    byId.set(event.eventId, {
      eventId: event.eventId,
      name: event.name,
      slug: event.slug,
      openDate: event.openDate,
    });
  }

  const merged = [...byId.values()].sort((a, b) => {
    if (!a.openDate) return 1;
    if (!b.openDate) return -1;
    return new Date(a.openDate) - new Date(b.openDate);
  });

  const payload = {
    fetchedAt: new Date().toISOString(),
    leagueId: WC_LEAGUE_ID,
    events: merged,
  };
  fs.writeFileSync(MAP_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function main() {
  const { start, end } = parseArgs();
  // eslint-disable-next-line no-console
  console.log(`Scanning DraftKings event IDs ${start}–${end} (concurrency ${CONCURRENCY})…\n`);

  const events = await scanRange(start, end);
  const payload = saveMap(events);

  // eslint-disable-next-line no-console
  console.log(`\nFound ${events.length} World Cup events → ${MAP_FILE}`);
  for (const event of events) {
    // eslint-disable-next-line no-console
    console.log(`  ${event.eventId}  ${event.name}`);
  }

  return payload;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
