/**
 * Full-book two-way scan: FanDuel event tabs + DraftKings league subcategories
 * for every CFB/NFL game that already matched on /api/rawarb.
 */

import {
  cachedBook,
  cdnSecondsForMemoryTtl,
  fillBookCache,
  requestIsFresh,
  setNoStore,
  setSharedCacheHeaders,
} from '../lib/bookCache.mjs';
import { fetchRawArbBook } from './rawarb.mjs';
import { extractDkContracts, extractFdContracts } from '../src/rawarb/extractMarkets.js';
import { attachDeepMarkets } from '../src/rawarb/mergeDeep.js';

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';
const FD_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; HwangDynasty-RawArb/1.0)',
};

const FD_TAB_SKIP = /parlay|sgm|same game|td scorer|touchdown scorer|quick bet/i;
const FD_TAB_SLUG = {
  popular: 'popular',
  '1st half': '1st-half',
  '2nd half': '2nd-half',
  '1st quarter': '1st-quarter',
  '2nd quarter': '2nd-quarter',
  '3rd quarter': '3rd-quarter',
  '4th quarter': '4th-quarter',
  scoring: 'scoring',
  'd/st': 'd-st',
  'passing props': 'passing-props',
  'receiving props': 'receiving-props',
  'rushing props': 'rushing-props',
  'game specials': 'game-specials',
  'quarter props': 'quarter-props',
};
const FD_FALLBACK_TABS = [...new Set(Object.values(FD_TAB_SLUG))];

const DK_PE_LOC = 'US-NJ';
const DK_NASH_BASE = `https://sportsbook-nash.draftkings.com/sites/${DK_PE_LOC}-SB/api`;
const DK_LEAGUES = {
  nfl: { id: '88808', referer: 'https://sportsbook.draftkings.com/leagues/football/nfl' },
  cfb: { id: '87637', referer: 'https://sportsbook.draftkings.com/leagues/football/ncaaf' },
};

const DK_SKIP_CAT = new Set([
  529, 787, 1076, 1286, 1803, 999, 1303, 1972, 1653, 1858, 1969, 1003,
]);
const DK_SKIP_SUB = /winning margin|correct score|3[\s-]?way|squares|octopus|most |combined |either player|each player|in each |shutout|comeback|halves won|every quarter|half time|full time|bands|to score 1st|to win with|largest lead|2 pt|game winning|drive|first down|1st (?:sack|turnover|first|reception)|specials$|dk specials|quick hits|scoring props|td props|quarter tds|safety props|punt props|field goal props(?!.*o\/u)|h2h|race to|listed half(?!.*total)/i;
const DK_KEEP_SUB = /alternate|o\/u|over.?under|odd\/?even|overtime|both teams|team total|pass |rush |rec |reception|completion|attempt|intercept|longest|sack|tackle|fantasy|kick|fg |pat |punt|1st score|highest scoring|quarter team|pass tds|rush \+ rec|^game$|1st half|2nd half|1st quarter|2nd quarter|3rd quarter|4th quarter/i;

function dkHeaders(referer, page = 'league') {
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://sportsbook.draftkings.com',
    Referer: referer,
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'x-client-feature': 'cms',
    'x-client-name': 'web',
    'x-client-page': page,
    'x-client-version': '1.14.0',
    'x-pe-cn': 'web',
    'x-pe-cv': '1.14.0',
    'x-pe-ep': 'SB',
    'x-pe-loc': DK_PE_LOC,
  };
}

async function fetchJson(url, headers, ms = 14000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

function slugsFromFdLayout(layout) {
  const tabs = Object.values(layout?.tabs ?? {});
  const slugs = [];
  for (const tab of tabs) {
    const title = String(tab.title ?? '').trim();
    if (!title || tab.isSameGameMulti || FD_TAB_SKIP.test(title)) continue;
    const slug = FD_TAB_SLUG[title.toLowerCase()];
    if (slug) slugs.push(slug);
  }
  return slugs.length ? [...new Set(slugs)] : FD_FALLBACK_TABS;
}

async function fdEventPage(eventId, tab) {
  const extra = tab ? `&tab=${encodeURIComponent(tab)}` : '';
  return fetchJson(`${FD_BASE}/event-page?${FD_QUERY}&eventId=${eventId}${extra}`, FD_HEADERS);
}

async function fdEventTabs(eventId) {
  const first = await fdEventPage(eventId, 'popular');
  const slugs = slugsFromFdLayout(first?.layout).filter((slug) => slug !== 'popular');
  const rest = await mapPool(slugs, 4, (tab) => fdEventPage(eventId, tab));
  const markets = {};
  const stamp = (payload, tab) => {
    for (const [id, market] of Object.entries(payload?.attachments?.markets ?? {})) {
      markets[id] = { ...market, _tab: tab };
    }
  };
  stamp(first, 'popular');
  slugs.forEach((tab, i) => stamp(rest[i], tab));
  return markets;
}

export function keepDkSubcategory(categoryId, categoryName, subName) {
  const catId = Number(categoryId);
  if (DK_SKIP_CAT.has(catId)) return false;
  const blob = `${categoryName ?? ''} ${subName ?? ''}`;
  if (DK_SKIP_SUB.test(subName) || DK_SKIP_SUB.test(blob)) return false;
  if (catId === 492 && /^game$/i.test(subName)) return false;
  if (catId === 1559 && /1st td/i.test(subName)) return false;
  return DK_KEEP_SUB.test(subName) || DK_KEEP_SUB.test(blob);
}

export function twoWaySubsFromLeague(json) {
  const cats = new Map((json?.categories ?? []).map((cat) => [Number(cat.id), cat.name]));
  const out = [];
  const seen = new Set();
  for (const sub of json?.subcategories ?? []) {
    const catId = Number(sub.categoryId);
    const name = sub.name ?? '';
    if (!keepDkSubcategory(catId, cats.get(catId) ?? '', name)) continue;
    const key = `${catId}/${sub.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([catId, Number(sub.id), `${cats.get(catId) ?? ''} ${name}`.trim()]);
  }
  return out;
}

async function dkLeague(sport) {
  const league = DK_LEAGUES[sport];
  return fetchJson(`${DK_NASH_BASE}/sportscontent/dkusny/v1/leagues/${league.id}`, dkHeaders(league.referer));
}

async function dkLeagueSub(sport, categoryId, subcategoryId, hint = '') {
  const league = DK_LEAGUES[sport];
  const url = `${DK_NASH_BASE}/sportscontent/dkusny/v1/leagues/${league.id}?categoryId=${categoryId}&subcategoryId=${subcategoryId}`;
  const json = await fetchJson(url, dkHeaders(league.referer), 16000);
  return { markets: json?.markets ?? [], selections: json?.selections ?? [], hint };
}

function groupDkByEvent(bundles) {
  const byEvent = new Map();
  for (const bundle of bundles) {
    const eventOf = new Map();
    for (const market of bundle.markets ?? []) {
      const eid = market.eventId != null ? String(market.eventId) : '';
      if (!eid) continue;
      eventOf.set(String(market.id), eid);
      if (!byEvent.has(eid)) byEvent.set(eid, { markets: [], selections: [] });
      byEvent.get(eid).markets.push({ ...market, hint: bundle.hint || market.hint });
    }
    for (const sel of bundle.selections ?? []) {
      const eid = eventOf.get(String(sel.marketId ?? ''));
      if (!eid) continue;
      byEvent.get(eid).selections.push(sel);
    }
  }
  return byEvent;
}

function flipDkBook(book) {
  if (!book) return book;
  const next = { ...book };
  if (book.away || book.home || book.aways || book.homes) {
    next.away = book.home;
    next.home = book.away;
    next.aways = book.homes;
    next.homes = book.aways;
  }
  return next;
}

function flipDkContracts(contracts) {
  return (contracts ?? []).map((row) => {
    if (row.kind !== 'spread' && row.kind !== 'moneyline') return row;
    return { ...row, dk: flipDkBook(row.dk) };
  });
}

function slimExtra(row) {
  return {
    key: row.key,
    label: row.label,
    kind: row.kind,
    main: row.main,
    fd: row.fd,
    dk: row.dk,
    twoWay: row.twoWay,
    arbAlts: row.arbAlts,
  };
}

export async function fetchRawArbDeep(baseGames) {
  const games = baseGames ?? (await fetchRawArbBook()).games;
  const matched = games.filter((game) => game.fdEventId && game.dkEventId);
  const now = Date.now();
  const fdTargets = matched.filter((game) => {
    if (game.inPlay) return true;
    const t = Date.parse(game.openDate);
    if (!Number.isFinite(t)) return true;
    return t <= now + 21 * 24 * 60 * 60 * 1000;
  });

  const fdMarketsById = new Map();
  const dkBySport = { nfl: new Map(), cfb: new Map() };
  const dkSubCounts = { nfl: 0, cfb: 0 };

  await Promise.all([
    mapPool(fdTargets, 6, async (game) => {
      try {
        fdMarketsById.set(String(game.fdEventId), await fdEventTabs(game.fdEventId));
      } catch {
        fdMarketsById.set(String(game.fdEventId), {});
      }
    }),
    mapPool(['nfl', 'cfb'], 2, async (sport) => {
      const catalog = await dkLeague(sport);
      const subs = twoWaySubsFromLeague(catalog || {});
      dkSubCounts[sport] = subs.length;
      const bundles = await mapPool(subs, 8, ([cat, sub, hint]) => dkLeagueSub(sport, cat, sub, hint));
      dkBySport[sport] = groupDkByEvent(bundles);
    }),
  ]);

  const attachments = games.map((game) => {
    const teams = { home: game.home, away: game.away };
    const fdContracts = extractFdContracts(fdMarketsById.get(String(game.fdEventId)) ?? {}, teams);
    let dkContracts = [];
    const dkBundle = dkBySport[game.sport]?.get(String(game.dkEventId));
    if (dkBundle) {
      dkContracts = extractDkContracts(dkBundle.markets, dkBundle.selections, teams);
      if (game.dkFlipped) dkContracts = flipDkContracts(dkContracts);
    }
    const scored = attachDeepMarkets(game, fdContracts, dkContracts);
    return {
      fdEventId: game.fdEventId,
      dkEventId: game.dkEventId,
      extras: (scored.extras ?? []).map(slimExtra),
      extraCount: scored.extraCount,
      extraArbCount: scored.extraArbCount,
      extraBestPSum: scored.extras?.find((row) => !row.main && row.twoWay)?.twoWay?.pSum ?? null,
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    attachments,
    stats: {
      games: attachments.length,
      extras: attachments.reduce((n, row) => n + (row.extraCount ?? 0), 0),
      extraArbs: attachments.reduce((n, row) => n + (row.extraArbCount ?? 0), 0),
      fdEvents: fdMarketsById.size,
      dkSubs: dkSubCounts,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const fresh = requestIsFresh(req);
    const ttlMs = 60_000;
    const data = fresh
      ? await fetchRawArbDeep()
      : await cachedBook('rawarb-deep', fetchRawArbDeep, () => ttlMs, { persist: true });
    if (fresh) {
      await fillBookCache('rawarb-deep', data, ttlMs, { persist: true });
      setNoStore(res);
    } else {
      setSharedCacheHeaders(res, cdnSecondsForMemoryTtl(ttlMs));
    }
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rawarb-deep]', err);
    return res.status(502).json({ error: err.message || 'Raw arb deep fetch failed' });
  }
}
