/**
 * DraftKings World Cup First Goal Method scraper (Nash / controldata API).
 * Proxies DraftKings' undocumented sportsbook API — structure can change without notice.
 *
 * Event IDs: api/dk-wc-event-map.json (from npm run dk:discover-events), optional
 * DK_COOKIE for league-page link scraping, or Nash ID-range probe for missing games.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWorldCupSopOdds as fetchFanDuelGames } from './fanduel-sop.mjs';
import {
  analyzeAgainstBreakeven,
  computeBreakevenOdds,
  DEFAULT_NO_GOAL_SOURCE,
  GOAL_TYPE_META,
} from '../src/sop/sopModel.js';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DK_COOKIE_FILE = path.join(SITE_DIR, '.dk-cookies.json');
const DK_EVENT_MAP_FILE = path.join(SITE_DIR, 'api', 'dk-wc-event-map.json');
const WC_LEAGUE_ID = '209533';
const FIRST_GOAL_METHOD_SUBCATEGORY_ID = '6541';
/** Live: "Next Goal (90 Mins)" — e.g. No 3rd Goal */
const NEXT_GOAL_LIVE_SUBCATEGORY_ID = '6007';
/** Live: alternate totals ladder */
const TOTAL_GOALS_LIVE_SUBCATEGORY_ID = '13171';

const DK_PE_LOC = (() => {
  const raw = (process.env.DK_PE_LOC || 'US-NY').trim().toUpperCase();
  return raw.startsWith('US-') ? raw : `US-${raw}`;
})();
const DK_SITE = process.env.DK_SITE || `${DK_PE_LOC}-SB`;
const DK_NASH_BASE = `https://sportsbook-nash.draftkings.com/sites/${DK_SITE}/api`;
const DK_FETCH_CONCURRENCY = Number(process.env.DK_FETCH_CONCURRENCY || 4);
const DK_FETCH_RETRIES = Number(process.env.DK_FETCH_RETRIES || 2);
const DK_FETCH_RETRY_MS = Number(process.env.DK_FETCH_RETRY_MS || 800);

const GOAL_TYPE_SELECTIONS = {
  sop: ['Shot', 'Shot Open Play', 'Open Play', 'Shot - Open Play'],
  header: ['Header'],
  pk: ['Penalty', 'Penalty Kick'],
  fk: ['Free Kick'],
  og: ['Own Goal'],
};

const NO_GOAL_SELECTIONS = ['No Goal', 'No Goals', 'Neither'];

function parseAmerican(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw)
    .trim()
    .replace(/\u2212/g, '-')
    .replace(/^\+/, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function labelMatches(label, candidates) {
  const target = normalizeLabel(label);
  return candidates.some((c) => target === normalizeLabel(c));
}

function fdNameToSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+v\s+/i, '-vs-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function loadDkCookieHeader() {
  const fromEnv = process.env.DK_COOKIE?.trim();
  if (fromEnv) return fromEnv;

  try {
    if (fs.existsSync(DK_COOKIE_FILE)) {
      const data = JSON.parse(fs.readFileSync(DK_COOKIE_FILE, 'utf8'));
      if (data.cookieHeader) return data.cookieHeader;
    }
  } catch (_) {}

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function nashHeaders({ page = 'event', referer = 'https://sportsbook.draftkings.com/leagues/soccer/fifa-world-cup' } = {}) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
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

  const cookie = loadDkCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function nashFetch(url, options = {}, attempt = 0) {
  const res = await fetch(url, {
    ...options,
    headers: { ...nashHeaders(options.headerOpts), ...options.headers },
  });

  if (res.status === 403 && attempt < DK_FETCH_RETRIES - 1) {
    const backoff = DK_FETCH_RETRY_MS * (attempt + 1) + Math.floor(Math.random() * 200);
    await sleep(backoff);
    return nashFetch(url, options, attempt + 1);
  }

  if (!res.ok) {
    const snippet = await res.text().catch(() => '');
    const blocked = res.status === 403 || /access denied/i.test(snippet);
    throw new Error(
      `DraftKings ${url.replace(DK_NASH_BASE, '')} returned ${res.status}${
        blocked ? ' (Akamai blocked — retry or set DK_PE_LOC for your state)' : ''
      }`,
    );
  }
  return res.json();
}

function marketsUrl(eventId, subcategoryId) {
  const marketsQuery = `$filter=eventId eq '${eventId}' AND clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`;
  const qs = new URLSearchParams({
    isBatchable: 'false',
    templateVars: `${eventId},${subcategoryId}`,
    marketsQuery,
    entity: 'markets',
  });
  return `${DK_NASH_BASE}/sportscontent/controldata/event/eventSubcategory/v1/markets?${qs}`;
}

function selectionQuote(selection) {
  if (!selection) return null;
  const american = parseAmerican(selection.displayOdds?.american ?? selection.oddsAmerican);
  return {
    american,
    status: selection.status ?? null,
    runnerName: selection.label ?? null,
  };
}

function findSelectionQuote(selections, names) {
  const list = Array.isArray(selections) ? selections : [];
  for (const name of names) {
    const match = list.find((s) => labelMatches(s.label, [name]));
    if (match) return selectionQuote(match);
  }
  return null;
}

function extractGoalTypes(selections) {
  const out = {};
  for (const [key, names] of Object.entries(GOAL_TYPE_SELECTIONS)) {
    const quote = findSelectionQuote(selections, names);
    if (quote) out[key] = quote;
  }
  return Object.keys(out).length ? out : null;
}

function extractNoGoalFromGoalMethod(market, selections, score, teams, inPlay) {
  const totalGoals = score.home + score.away;
  const nextGoalNumber = totalGoals + 1;
  const underLine = totalGoals + 0.5;
  const scoreKey = `${score.home}-${score.away}`;

  const noGoal = findSelectionQuote(selections, NO_GOAL_SELECTIONS);

  return {
    nextGoalMethod: {
      market: market?.name ?? '1st Goal Method of Scoring',
      selection: 'No Goal',
      ...noGoal,
    },
    correctScore: {
      market: 'Correct Score',
      selection: scoreKey,
      scoreUsed: scoreKey,
      american: null,
      status: null,
      runnerName: null,
    },
    totalGoalsUnder: {
      market: 'Total Goals',
      selection: `Under ${underLine}`,
      line: underLine,
      totalGoals,
      american: null,
      status: null,
      runnerName: null,
    },
    nthGoalNeither: {
      market: `${nextGoalNumber} Goal`,
      selection: 'Neither',
      goalNumber: nextGoalNumber,
      american: null,
      status: null,
      runnerName: null,
    },
    nextGoalscorer: {
      market: 'Next Goalscorer',
      selection: 'No Goalscorer',
      goalNumber: nextGoalNumber,
      american: null,
      status: null,
      runnerName: null,
    },
    meta: {
      score: scoreKey,
      teams,
      totalGoals,
      nextGoalNumber,
      inPlay,
    },
  };
}

function ordinalSuffix(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 'th';
  const v = num % 100;
  return ['th', 'st', 'nd', 'rd'][v > 10 && v < 14 ? 0 : num % 10] || 'th';
}

function findNoNthGoalQuote(selections, goalNumber) {
  const list = Array.isArray(selections) ? selections : [];
  const ordinal = `${goalNumber}${ordinalSuffix(goalNumber)}`;
  const candidates = [
    `No ${ordinal} Goal`,
    `No ${goalNumber} Goal`,
    'No Goal',
    'No Goals',
    'Neither',
  ];
  const byName = findSelectionQuote(list, candidates);
  if (byName?.american != null) return byName;

  const regex = new RegExp(`no\\s+${goalNumber}(?:${ordinalSuffix(goalNumber)})?\\s+goal`, 'i');
  const match = list.find((s) => regex.test(String(s.label ?? '')));
  return match ? selectionQuote(match) : null;
}

function extractNoGoalFromNextGoalLive(markets, selections, score) {
  const totalGoals = score.home + score.away;
  const goalNumber = totalGoals + 1;
  const market =
    (markets ?? []).find((m) => new RegExp(`${goalNumber}(?:${ordinalSuffix(goalNumber)})?\\s+goal`, 'i').test(m.name ?? ''))
    ?? (markets ?? []).find((m) => /next goal/i.test(m.name ?? ''))
    ?? markets?.[0]
    ?? null;
  if (!market) return null;

  const marketSelections = selections.filter((s) => s.marketId === market.id);
  const quote = findNoNthGoalQuote(marketSelections, goalNumber);
  if (!quote || quote.american == null) return null;

  return {
    market: market.name ?? `Next Goal (${goalNumber})`,
    selection: quote?.runnerName ?? `No ${goalNumber}${ordinalSuffix(goalNumber)} Goal`,
    ...quote,
  };
}

function extractTotalGoalsUnderLive(markets, selections, score) {
  const totalGoals = score.home + score.away;
  const underLine = totalGoals + 0.5;
  const lineStr = String(underLine);

  for (const market of markets ?? []) {
    const marketSelections = selections.filter((s) => s.marketId === market.id);
    const under = marketSelections.find((s) => {
      const label = String(s.label ?? '').toLowerCase();
      if (!label.startsWith('under')) return false;
      const points = s.points ?? s.line ?? market.points ?? market.line;
      if (points != null && Number(points) === underLine) return true;
      return label.includes(lineStr);
    });
    if (under) {
      return {
        market: market.name ?? 'Total Goals',
        selection: `Under ${underLine}`,
        line: underLine,
        totalGoals,
        ...selectionQuote(under),
      };
    }
  }
  return null;
}

async function fetchSubcategoryMarkets(eventId, subcategoryId, seoSlug) {
  const payload = await nashFetch(marketsUrl(eventId, subcategoryId), {
    headerOpts: {
      page: 'event',
      referer: `https://sportsbook.draftkings.com/event/${seoSlug}/${eventId}`,
    },
  });
  return {
    markets: payload.markets ?? [],
    selections: payload.selections ?? [],
  };
}

async function fetchLiveDkBundle(eventId, eventMeta = {}) {
  const seoSlug = eventMeta.seoSlug ?? 'world-cup';
  const teams = eventMeta.teams ?? { home: null, away: null };
  const score = eventMeta.score ?? { home: 0, away: 0 };
  const base = extractNoGoalFromGoalMethod(null, [], score, teams, true);

  let nextGoalMethod = null;
  let totalGoalsUnder = null;
  let marketName = null;

  try {
    const nextGoal = await fetchSubcategoryMarkets(
      eventId,
      NEXT_GOAL_LIVE_SUBCATEGORY_ID,
      seoSlug,
    );
    nextGoalMethod = extractNoGoalFromNextGoalLive(
      nextGoal.markets,
      nextGoal.selections,
      score,
    );
    if (nextGoalMethod?.american != null) {
      marketName = nextGoalMethod.market;
    }
  } catch (_) {}

  try {
    const totals = await fetchSubcategoryMarkets(
      eventId,
      TOTAL_GOALS_LIVE_SUBCATEGORY_ID,
      seoSlug,
    );
    totalGoalsUnder = extractTotalGoalsUnderLive(totals.markets, totals.selections, score);
  } catch (_) {}

  const noGoalMarkets = {
    ...base,
    ...(nextGoalMethod?.american != null ? { nextGoalMethod } : {}),
    ...(totalGoalsUnder?.american != null ? { totalGoalsUnder } : {}),
  };

  return {
    goalTypes: null,
    noGoalMarkets,
    marketName,
  };
}

async function fetchFirstGoalMethodBundle(eventId, eventMeta = {}) {
  const seoSlug = eventMeta.seoSlug ?? 'world-cup';
  const teams = eventMeta.teams ?? { home: null, away: null };
  const score = eventMeta.score ?? { home: 0, away: 0 };
  const inPlay = Boolean(eventMeta.inPlay);

  if (inPlay) {
    return fetchLiveDkBundle(eventId, { seoSlug, teams, score });
  }

  const { markets, selections } = await fetchSubcategoryMarkets(
    eventId,
    FIRST_GOAL_METHOD_SUBCATEGORY_ID,
    seoSlug,
  );

  const market =
    markets.find((m) => /goal method/i.test(m.name ?? '')) ?? markets[0] ?? null;
  const marketSelections = selections.filter((s) => s.marketId === market?.id);

  return {
    goalTypes: extractGoalTypes(marketSelections),
    noGoalMarkets: extractNoGoalFromGoalMethod(market, marketSelections, score, teams, inPlay),
    marketName: market?.name ?? null,
  };
}

async function fetchDkEventMeta(eventId) {
  const qs = new URLSearchParams({ eventIds: eventId });
  const payload = await nashFetch(
    `${DK_NASH_BASE}/sportscontent/pagedata/event/v1/events?${qs}`,
    { headerOpts: { page: 'event' } },
  );
  const event = payload?.events?.[0];
  if (!event) return null;

  const participants = event.participants ?? [];
  const home = participants.find((p) => p.venueRole === 'Home')?.name ?? null;
  const away = participants.find((p) => p.venueRole === 'Away')?.name ?? null;

  return {
    eventId: String(event.id),
    name: event.name,
    seoSlug: event.seoIdentifier ?? fdNameToSlug(event.name),
    openDate: event.startEventDate ?? null,
    inPlay: String(event.status ?? '').toUpperCase() === 'STARTED',
    teams: { home, away },
    score: { home: 0, away: 0 },
  };
}

function loadStaticDkEventMapMeta() {
  try {
    return JSON.parse(fs.readFileSync(DK_EVENT_MAP_FILE, 'utf8'));
  } catch (_) {
    return { fetchedAt: null, events: [] };
  }
}

function loadStaticDkEventMap() {
  const map = new Map();
  const data = loadStaticDkEventMapMeta();
  for (const event of data.events ?? []) {
    if (event.slug && event.eventId) map.set(event.slug, String(event.eventId));
  }
  return map;
}

function isUpcomingGame(game) {
  if (game.inPlay) return false;
  if (!game.openDate) return true;
  return new Date(game.openDate) > new Date();
}

function noGoalProxySources(bundle, fdGame) {
  const fd = fdGame.noGoalMarkets ?? {};
  const dk = bundle.noGoalMarkets ?? {};
  const source = (key) => {
    if (dk[key]?.american != null) return 'dk';
    if (fd[key]?.american != null) return 'fd';
    return null;
  };
  return {
    nextGoalMethod: source('nextGoalMethod'),
    correctScore: source('correctScore'),
    totalGoalsUnder: source('totalGoalsUnder'),
    nthGoalNeither: source('nthGoalNeither'),
    nextGoalscorer: source('nextGoalscorer'),
  };
}

function friendlyGameError(message) {
  const text = String(message ?? '');
  if (/403|akamai|access denied/i.test(text)) {
    return 'DraftKings odds blocked from this server (Akamai) — retry in a moment';
  }
  if (/event id not found/i.test(text)) {
    return 'DraftKings event ID not found for this match';
  }
  if (text.length > 120) return 'Could not load DraftKings odds for this match';
  return text;
}

function saveStaticDkEventMap(events) {
  const payload = {
    fetchedAt: new Date().toISOString(),
    leagueId: WC_LEAGUE_ID,
    events: events.map((event) => ({
      eventId: event.eventId,
      name: event.name,
      slug: event.slug,
      openDate: event.openDate ?? null,
    })),
  };
  fs.writeFileSync(DK_EVENT_MAP_FILE, `${JSON.stringify(payload, null, 2)}\n`);
}

async function fetchDkEventMetaQuiet(eventId) {
  const qs = new URLSearchParams({ eventIds: eventId });
  const res = await fetch(`${DK_NASH_BASE}/sportscontent/pagedata/event/v1/events?${qs}`, {
    headers: nashHeaders({ page: 'league' }),
  });
  if (!res.ok) return null;
  const event = (await res.json()).events?.[0];
  if (!event || String(event.leagueId) !== WC_LEAGUE_ID) return null;
  return {
    eventId: String(event.id),
    name: event.name,
    slug: event.seoIdentifier ?? fdNameToSlug(event.name),
    openDate: event.startEventDate ?? null,
  };
}

async function probeMissingDkEvents(missingGames, slugToId) {
  if (!missingGames.length) return slugToId;

  const knownIds = [...slugToId.values()].map(Number).filter(Number.isFinite);
  const start = knownIds.length
    ? Math.min(...knownIds) - 2500
    : Number(process.env.DK_SCAN_START || 34322000);
  const end = knownIds.length
    ? Math.max(...knownIds) + 2500
    : Number(process.env.DK_SCAN_END || 34332000);
  const concurrency = Number(process.env.DK_SCAN_CONCURRENCY || 15);
  const deadline = Date.now() + Number(process.env.DK_PROBE_TIMEOUT_MS || 25000);

  const neededSlugs = new Set(missingGames.map((g) => fdNameToSlug(g.name)));
  const discovered = [];

  for (let base = start; base < end && Date.now() < deadline; base += concurrency) {
    if (neededSlugs.size === 0) break;

    const ids = Array.from({ length: Math.min(concurrency, end - base) }, (_, i) => base + i);
    const results = await Promise.all(ids.map((id) => fetchDkEventMetaQuiet(id)));
    for (const event of results) {
      if (!event?.slug) continue;
      slugToId.set(event.slug, event.eventId);
      discovered.push(event);
      neededSlugs.delete(event.slug);
    }
  }

  if (discovered.length) {
    const merged = new Map();
    for (const event of loadStaticDkEventMap().entries()) merged.set(event[0], event[1]);
    for (const event of discovered) merged.set(event.slug, event.eventId);
    try {
      const existing = JSON.parse(fs.readFileSync(DK_EVENT_MAP_FILE, 'utf8'));
      const byId = new Map((existing.events ?? []).map((e) => [e.eventId, e]));
      for (const event of discovered) byId.set(event.eventId, event);
      saveStaticDkEventMap([...byId.values()]);
    } catch (_) {
      saveStaticDkEventMap(discovered);
    }
  }

  return slugToId;
}

async function discoverDkEventsFromLeaguePage() {
  const map = loadStaticDkEventMap();
  const cookie = loadDkCookieHeader();
  if (!cookie) return map;

  const res = await fetch('https://sportsbook.draftkings.com/leagues/soccer/fifa-world-cup', {
    headers: {
      ...nashHeaders({ page: 'league' }),
      Accept: 'text/html',
    },
  });
  if (!res.ok) return map;

  const html = await res.text();
  for (const match of html.matchAll(/\/event\/([a-z0-9-]+)\/(\d{7,8})/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function resolveDkEventIdSync(fdGame, slugToId) {
  const slug = fdNameToSlug(fdGame.name);
  if (slugToId.has(slug)) return slugToId.get(slug);

  // Fuzzy: ivory-coast-vs-norway vs ivory-coast-v-norway slug variants
  for (const [mapSlug, eventId] of slugToId.entries()) {
    if (mapSlug.replace(/-v-/g, '-vs-') === slug.replace(/-v-/g, '-vs-')) return eventId;
  }

  return null;
}

async function resolveDkEventId(fdGame, slugToId) {
  return resolveDkEventIdSync(fdGame, slugToId);
}

async function fetchOneDkGame(fdGame, slugToId) {
  const base = {
    eventId: fdGame.eventId,
    name: fdGame.name,
    openDate: fdGame.openDate,
    inPlay: fdGame.inPlay,
    score: fdGame.score,
    scoreDisplay: fdGame.scoreDisplay,
    teams: fdGame.teams,
  };

  try {
    const dkEventId = await resolveDkEventId(fdGame, slugToId);
    if (!dkEventId) {
      return {
        ...base,
        dkEventId: null,
        error: 'DraftKings event ID not found for this match',
        errorCode: 'event_not_found',
      };
    }

    const bundle = await fetchFirstGoalMethodBundle(dkEventId, {
      seoSlug: fdNameToSlug(fdGame.name),
      teams: fdGame.teams,
      score: fdGame.score,
      inPlay: fdGame.inPlay,
    });

    return {
      ...base,
      eventId: dkEventId,
      dkEventId,
      marketName: bundle.marketName,
      goalTypes: bundle.goalTypes,
      noGoalMarkets: bundle.noGoalMarkets,
      noGoalProxySources: noGoalProxySources(bundle, fdGame),
    };
  } catch (err) {
    return {
      ...base,
      dkEventId: resolveDkEventIdSync(fdGame, slugToId),
      error: friendlyGameError(err.message),
      errorCode: /403|akamai|access denied/i.test(err.message) ? 'markets_blocked' : 'markets_error',
    };
  }
}

export async function fetchWorldCupGoalMethodOdds({ upcomingOnly = true } = {}) {
  const fdPayload = await fetchFanDuelGames();
  const scheduleGames = upcomingOnly
    ? fdPayload.games.filter(isUpcomingGame)
    : fdPayload.games;
  let slugToId = await discoverDkEventsFromLeaguePage();

  const missingGames = scheduleGames.filter((g) => !resolveDkEventIdSync(g, slugToId));
  if (missingGames.length && process.env.DK_PROBE_EVENTS === '1') {
    slugToId = await probeMissingDkEvents(missingGames, slugToId);
  }

  let results = await mapPool(scheduleGames, DK_FETCH_CONCURRENCY, (fdGame) =>
    fetchOneDkGame(fdGame, slugToId),
  );

  const blockedIndexes = results
    .map((result, index) => (result.errorCode === 'markets_blocked' ? index : -1))
    .filter((index) => index >= 0);

  if (blockedIndexes.length) {
    await sleep(1200);
    for (const index of blockedIndexes) {
      const retry = await fetchOneDkGame(scheduleGames[index], slugToId);
      if (retry.goalTypes) results[index] = retry;
      await sleep(300);
    }
  }

  results.sort((a, b) => {
    if (!a.openDate) return 1;
    if (!b.openDate) return -1;
    return new Date(a.openDate) - new Date(b.openDate);
  });

  const withOdds = results.filter((g) => g.goalTypes).length;
  const withEventId = results.filter((g) => g.dkEventId).length;
  const evPlus = results.reduce((sum, g) => sum + countGameEvBets(g), 0);

  const mapMeta = loadStaticDkEventMapMeta();

  return {
    fetchedAt: new Date().toISOString(),
    eventMapUpdatedAt: mapMeta.fetchedAt ?? null,
    stats: {
      total: results.length,
      withEventId,
      withOdds,
      missingEventId: results.length - withEventId,
      totalEvBets: evPlus,
    },
    games: results,
  };
}

function countGameEvBets(game) {
  if (!game.goalTypes || !game.noGoalMarkets) return 0;
  const noGoal =
    game.noGoalMarkets[DEFAULT_NO_GOAL_SOURCE]?.american ??
    game.noGoalMarkets.nextGoalMethod?.american;
  if (noGoal == null) return 0;
  const model = computeBreakevenOdds(noGoal);
  if (!model) return 0;
  return GOAL_TYPE_META.filter(({ key }) => {
    const bookAmerican = game.goalTypes[key]?.american;
    const breakeven = model[key]?.american;
    return analyzeAgainstBreakeven(bookAmerican, breakeven)?.profitable;
  }).length;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const upcomingOnly = req.query?.all !== '1' && req.query?.all !== 'true';
    const data = await fetchWorldCupGoalMethodOdds({ upcomingOnly });
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[draftkings-goal-method]', err);
    return res.status(502).json({ error: err.message || 'DraftKings fetch failed' });
  }
}
