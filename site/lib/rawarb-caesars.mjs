/**
 * Caesars games from every competition tab, not just the homepage slate.
 * Deep markets come from the event payload (alts, halves, team totals).
 */

import { extractCaesarsContracts, extractCaesarsPayload } from '../src/rawarb/caesarsExtract.js';
import { loadCaesarsToken } from './caesarsSession.mjs';

const BASE = 'https://api.americanwagering.com/regions/us/locations/nj/brands/czr/sb';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const KEEP_SPORTS = new Set([
  'americanfootball',
  'basketball',
  'baseball',
  'icehockey',
  'football',
  'tennis',
  'ufcmma',
  'boxing',
  'cricket',
  'rugbyleague',
  'rugbyunion',
]);

const DEEP_TABS = ['Half', 'Quarter', 'Team Totals', 'Game Totals'];

function headers(token) {
  const row = {
    Accept: 'application/json',
    'User-Agent': UA,
    Origin: 'https://sportsbook.caesars.com',
    Referer: 'https://sportsbook.caesars.com/us/nj/bet',
    'X-Platform': 'cordova-desktop',
    'X-App-Version': '7.57.0',
    'X-Unique-Device-Id': '951da4d8-35ce-4515-875a-1becdbb24a46',
  };
  if (token) row.Cookie = `aws-waf-token=${token}`;
  return row;
}

async function czrGet(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: headers(token),
    signal: AbortSignal.timeout(18000),
  });
  if (res.status === 202 || res.status === 403) {
    const err = new Error(`Caesars blocked ${path} (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Caesars ${path} returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

function competitionsFromMenu(menu) {
  const comps = [];
  for (const sport of menu || []) {
    if (!KEEP_SPORTS.has(sport?.sportId)) continue;
    for (const comp of sport.competitions || []) {
      if (!comp?.id) continue;
      if (/future|outright|award|specials|winner$/i.test(comp.name || '')) continue;
      comps.push({ sportId: sport.sportId, id: comp.id, name: comp.name || '' });
    }
  }
  return comps;
}

export async function fetchCaesarsGames() {
  const token = loadCaesarsToken();
  if (!token) {
    throw new Error('Caesars needs a browser aws-waf-token in site/.caesars-waf.json');
  }
  const menu = await czrGet('/v3/sports-menu', token);
  const comps = competitionsFromMenu(menu);
  const tabs = await mapPool(comps, 6, async (comp) => {
    try {
      return await czrGet(
        `/v4/sports/${encodeURIComponent(comp.sportId)}/competitions/${comp.id}/tabs`,
        token,
      );
    } catch (err) {
      if (err.status === 202 || err.status === 403) throw err;
      return null;
    }
  });
  const seen = new Set();
  const games = [];
  const needEvent = [];
  for (const payload of tabs) {
    if (!payload) continue;
    for (const comp of payload.competitions || []) {
      for (const event of comp.events || []) {
        if (!event?.id || seen.has(event.id)) continue;
        const [game] = extractCaesarsPayload({ event });
        if (game) {
          seen.add(game.eventId);
          games.push(game);
          continue;
        }
        // Soccer (and some other leagues) only put the 3-way on the
        // competition tab. The event payload has the two-way total and spread.
        if (String(event.type || 'MATCH').toUpperCase() === 'MATCH') needEvent.push(event.id);
      }
    }
  }
  const details = await mapPool(needEvent.slice(0, 320), 6, async (eventId) => {
    try {
      return await czrGet(`/v4/events/${encodeURIComponent(eventId)}`, token);
    } catch (err) {
      if (err.status === 202 || err.status === 403) throw err;
      return null;
    }
  });
  for (const detail of details) {
    if (!detail) continue;
    for (const game of extractCaesarsPayload(detail)) {
      if (seen.has(game.eventId)) continue;
      seen.add(game.eventId);
      games.push(game);
    }
  }
  if (!games.length) {
    throw new Error('Caesars competition tabs returned no games');
  }
  return { games, notices: [] };
}

function groupsFrom(payload, eventId) {
  if (!payload) return [];
  if (payload.keyMarketGroups && (!payload.id || !eventId || payload.id === eventId)) {
    return payload.keyMarketGroups;
  }
  if (payload.event?.keyMarketGroups) return payload.event.keyMarketGroups;
  const groups = [];
  for (const comp of payload.competitions || []) {
    for (const ev of comp.events || []) {
      if (eventId && ev.id && ev.id !== eventId) continue;
      groups.push(...(ev.keyMarketGroups || []));
    }
  }
  return groups;
}

function mergeEventMarkets(base, extra, eventId) {
  const event = base?.event || base;
  if (!event) return base;
  const groups = groupsFrom(extra, eventId);
  if (!groups.length) return event;
  return {
    ...event,
    keyMarketGroups: [...(event.keyMarketGroups || []), ...groups],
  };
}

/** Full-ish two-way book for one matched Caesars event. */
export async function fetchCaesarsEvent(eventId, token = loadCaesarsToken()) {
  if (!token || !eventId) return null;
  const event = await czrGet(`/v4/events/${encodeURIComponent(eventId)}`, token);
  let merged = event?.event || event;
  const tabs = await mapPool(DEEP_TABS, 4, async (tab) => {
    try {
      return await czrGet(`/v4/events/${encodeURIComponent(eventId)}/tabs/${encodeURIComponent(tab)}`, token);
    } catch {
      return null;
    }
  });
  for (const tab of tabs) {
    if (tab) merged = mergeEventMarkets(merged, tab, eventId);
  }
  return merged;
}

export async function fetchCaesarsContracts(eventId, teams) {
  const event = await fetchCaesarsEvent(eventId);
  if (!event) return [];
  return extractCaesarsContracts(event, teams);
}
