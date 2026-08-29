/**
 * Kalshi Premier League no-goal proxy scraper.
 * Maps KXEPLTOTAL (Under via NO on Over), KXEPLSCORE (exact score YES),
 * and KXEPLGOAL (No Goalscorer) to SOP keys.
 */

import { fetchWorldCupSopOdds as fetchFanDuelGames } from './fanduel-sop.mjs';
import { probToAmerican } from '../src/sop/sopModel.js';

const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';

const EPL_SERIES = {
  total: 'KXEPLTOTAL',
  score: 'KXEPLSCORE',
  firstGoal: 'KXEPLFIRSTGOAL',
  ftts: 'KXEPLFTTS',
};

const KALSHI_MIN_INTERVAL_MS = Number(process.env.KALSHI_MIN_INTERVAL_MS || 120);
const KALSHI_RESPONSE_CACHE_MS = Number(process.env.KALSHI_RESPONSE_CACHE_MS || 30_000);
const KALSHI_EVENTS_CACHE_MS = Number(process.env.KALSHI_EVENTS_CACHE_MS || 5 * 60_000);
const KALSHI_MARKETS_CACHE_MS = Number(process.env.KALSHI_MARKETS_CACHE_MS || 30_000);
const KALSHI_MAX_RETRIES = Number(process.env.KALSHI_MAX_RETRIES || 6);

const TEAM_ALIASES = {
  'afc bournemouth': 'bournemouth',
  'everton fc': 'everton',
  'fulham fc': 'fulham',
  'arsenal fc': 'arsenal',
  'chelsea fc': 'chelsea',
  'liverpool fc': 'liverpool',
  'brentford fc': 'brentford',
  'sunderland afc': 'sunderland',
  'hull city': 'hull',
  'coventry city': 'coventry',
  'leicester city': 'leicester',
  'ipswich town': 'ipswich',
  'leeds united': 'leeds',
  'nottingham forest': 'nottingham forest',
  'nottm forest': 'nottingham forest',
  "nott'm forest": 'nottingham forest',
  'manchester united': 'man utd',
  'man utd': 'man utd',
  'man united': 'man utd',
  'manchester city': 'man city',
  'man city': 'man city',
  'tottenham hotspur': 'tottenham',
  'newcastle united': 'newcastle',
  'brighton and hove albion': 'brighton',
  'brighton hove albion': 'brighton',
  'west ham united': 'west ham',
  'wolverhampton wanderers': 'wolves',
  'crystal palace': 'crystal palace',
};

/** Serialize Kalshi HTTP calls with spacing to avoid 429 bursts. */
let kalshiQueue = Promise.resolve();
let lastKalshiRequestAt = 0;

const eventsCache = new Map();
const marketsCache = new Map();
let responseCache = { key: null, at: 0, data: null, inflight: null };

function stripTeamDecorators(name) {
  return String(name ?? '')
    .replace(/^afc\s+/, '')
    .replace(/\s+afc$/, '')
    .replace(/\s+fc$/, '')
    .replace(/\s+town$/, '')
    .replace(/\s+united$/, '')
    .replace(/\s+hotspur$/, '')
    .trim();
}

function normalizeTeamName(name) {
  let s = String(name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = TEAM_ALIASES[s] ?? s;
  const stripped = stripTeamDecorators(s);
  s = TEAM_ALIASES[stripped] ?? stripped;
  if (s.endsWith(' city') && s !== 'man city') {
    const short = s.replace(/\s+city$/, '');
    s = TEAM_ALIASES[short] ?? short;
  }
  return TEAM_ALIASES[s] ?? s;
}

function fixtureKeyFromTeams(home, away) {
  const pair = [normalizeTeamName(home), normalizeTeamName(away)].sort();
  return pair.join('|');
}

export function fixtureKeyFromFdName(name) {
  const parts = String(name ?? '').split(/\s+v\s+/i);
  if (parts.length !== 2) return null;
  return fixtureKeyFromTeams(parts[0].trim(), parts[1].trim());
}

export function parseKalshiFixture(title) {
  const m = String(title ?? '').match(/^(.+?)\s+vs\s+(.+?)(?::|$)/i);
  if (!m) return null;
  return fixtureKeyFromTeams(m[1].trim(), m[2].trim());
}

const KALSHI_MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function dateFromKalshiTicker(ticker) {
  const m = String(ticker ?? '').match(/-(\d{2})([A-Z]{3})(\d{2})[A-Z]/);
  if (!m) return null;
  const month = KALSHI_MONTHS[m[2]];
  if (month == null) return null;
  return Date.UTC(2000 + Number(m[1]), month, Number(m[3]));
}

export function pickKalshiEvent(events, openDate) {
  const list = (events ?? []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1 || !openDate) return list[0];
  const target = Date.parse(openDate);
  if (!Number.isFinite(target)) return list[0];
  let best = list[0];
  let bestDist = Infinity;
  for (const event of list) {
    const fromFields = Date.parse(event.target_datetime || event.close_time || '');
    const stamp = dateFromKalshiTicker(event.event_ticker)
      ?? (Number.isFinite(fromFields) ? fromFields : null);
    if (stamp == null) continue;
    const dist = Math.abs(stamp - target);
    if (dist < bestDist) {
      best = event;
      bestDist = dist;
    }
  }
  return best;
}

function scoreKey(score) {
  return `${score.home}-${score.away}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCacheEntry(map, key, maxAgeMs) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > maxAgeMs) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function writeCacheEntry(map, key, value) {
  map.set(key, { at: Date.now(), value });
}

function enqueueKalshi(task) {
  const run = kalshiQueue.then(task, task);
  kalshiQueue = run.catch(() => {});
  return run;
}

async function kalshiFetch(path) {
  return enqueueKalshi(async () => {
    for (let attempt = 0; attempt <= KALSHI_MAX_RETRIES; attempt += 1) {
      const wait = KALSHI_MIN_INTERVAL_MS - (Date.now() - lastKalshiRequestAt);
      if (wait > 0) await sleep(wait);

      lastKalshiRequestAt = Date.now();
      const res = await fetch(`${KALSHI_BASE}${path}`);

      if (res.status === 429 && attempt < KALSHI_MAX_RETRIES) {
        const retryAfterSec = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : 600 * (2 ** attempt) + Math.floor(Math.random() * 250);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const snippet = await res.text().catch(() => '');
        throw new Error(
          `Kalshi ${path} returned ${res.status}${snippet ? `: ${snippet.slice(0, 120)}` : ''}`,
        );
      }

      return res.json();
    }

    throw new Error(`Kalshi ${path} failed after ${KALSHI_MAX_RETRIES + 1} attempts`);
  });
}

export async function fetchAllKalshiEvents(seriesTicker) {
  const cached = readCacheEntry(eventsCache, seriesTicker, KALSHI_EVENTS_CACHE_MS);
  if (cached) return cached;

  const events = [];
  let cursor = null;

  do {
    const qs = new URLSearchParams({ series_ticker: seriesTicker, limit: '200', status: 'open' });
    if (cursor) qs.set('cursor', cursor);
    const payload = await kalshiFetch(`/events?${qs}`);
    events.push(...(payload.events ?? []));
    cursor = payload.cursor || null;
    if (!cursor || !(payload.events ?? []).length) break;
  } while (cursor);

  writeCacheEntry(eventsCache, seriesTicker, events);
  return events;
}

export async function fetchMarketsForEvent(eventTicker) {
  const cached = readCacheEntry(marketsCache, eventTicker, KALSHI_MARKETS_CACHE_MS);
  if (cached) return cached;

  const qs = new URLSearchParams({ event_ticker: eventTicker, limit: '100' });
  const payload = await kalshiFetch(`/markets?${qs}`);
  const markets = payload.markets ?? [];
  writeCacheEntry(marketsCache, eventTicker, markets);
  return markets;
}

async function loadMarketsForTickers(tickers) {
  const list = [...tickers];
  const byEvent = new Map();
  const concurrency = 3;
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      const ticker = list[index];
      byEvent.set(ticker, await fetchMarketsForEvent(ticker));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, () => worker()));
  return byEvent;
}

export function kalshiAskToAmerican(askDollars) {
  const price = Number(askDollars);
  // Ignore locked / placeholder books (0.01 / 0.99 / 1.00).
  if (!Number.isFinite(price) || price <= 0.02 || price >= 0.98) return null;
  const american = probToAmerican(price);
  return american == null ? null : Math.round(american);
}

function marketQuote(market, { side, selection, extra = {} }) {
  const askKey = side === 'no' ? 'no_ask_dollars' : 'yes_ask_dollars';
  const american = kalshiAskToAmerican(market?.[askKey]);
  if (american == null) return null;
  return {
    market: market.title ?? null,
    selection,
    american,
    status: market.status ?? null,
    ticker: market.ticker ?? null,
    ...extra,
  };
}

function extractTotalGoalsUnder(markets, score) {
  const totalGoals = score.home + score.away;
  const underLine = totalGoals + 0.5;

  const market = (markets ?? []).find((m) => {
    const strike = Number(m.floor_strike);
    return Number.isFinite(strike) && Math.abs(strike - underLine) < 0.001;
  });
  if (!market) return null;

  return marketQuote(market, {
    side: 'no',
    selection: `Under ${underLine}`,
    extra: {
      line: underLine,
      totalGoals,
      eventTicker: market.event_ticker ?? null,
    },
  });
}

function extractNoGoalscorer(markets) {
  const market = (markets ?? []).find((m) => {
    const title = String(m.title ?? '').toLowerCase();
    const ticker = String(m.ticker ?? '');
    const strike = String(m.custom_strike?.player ?? m.custom_strike?.name ?? '');
    return (
      /(?:^|:\s*)no goal(?:scorer)?\b/.test(title)
      || /no one scores|none of the above/.test(title)
      || /no goalscorer/i.test(strike)
      || /-NOGOAL$/i.test(ticker)
    );
  });
  if (!market) return null;
  return marketQuote(market, {
    side: 'yes',
    selection: 'No Goalscorer',
    extra: { eventTicker: market.event_ticker ?? null },
  });
}

function extractNoFirstTeamToScore(markets) {
  const market = (markets ?? []).find((m) => {
    const title = String(m.title ?? '').toLowerCase();
    const ticker = String(m.ticker ?? '');
    return /will no goal be scored/.test(title)
      || /no (?:team )?to score|neither/.test(title)
      || /-(?:NONE|NOGOAL)$/i.test(ticker);
  });
  if (!market) return null;
  return marketQuote(market, {
    side: 'yes',
    selection: 'No Goal',
    extra: { eventTicker: market.event_ticker ?? null },
  });
}

function extractCorrectScore(markets, score) {
  const key = scoreKey(score);
  const home = String(score.home);
  const away = String(score.away);

  const market = (markets ?? []).find((m) => {
    const strike = m.custom_strike ?? {};
    if (String(strike.home_score) === home && String(strike.away_score) === away) return true;
    const title = String(m.title ?? '');
    return new RegExp(`\\b${home}\\s*[-–:]\\s*${away}\\b`).test(title);
  });
  if (!market) return null;

  return marketQuote(market, {
    side: 'yes',
    selection: key,
    extra: {
      scoreUsed: key,
      eventTicker: market.event_ticker ?? null,
    },
  });
}

function emptyNoGoalMarkets() {
  return {
    nextGoalMethod: null,
    correctScore: null,
    totalGoalsUnder: null,
    nthGoalNeither: null,
    nextGoalscorer: null,
  };
}

function buildKalshiEventIndex(events) {
  const byFixture = new Map();
  for (const event of events) {
    const key = parseKalshiFixture(event.title);
    if (!key) continue;
    const list = byFixture.get(key) ?? [];
    list.push(event);
    byFixture.set(key, list);
  }
  return byFixture;
}

function isUpcomingGame(game) {
  // Include live matches; only drop fixtures that have already kicked off and finished.
  if (game.inPlay) return true;
  if (!game.openDate) return true;
  return new Date(game.openDate) > new Date();
}

function klshHasNoGoalData(noGoalMarkets) {
  if (!noGoalMarkets) return false;
  return Object.values(noGoalMarkets).some((q) => q?.american != null);
}

function collectNeededEventTickers(scheduleGames, indexes) {
  const tickers = Object.fromEntries(Object.keys(EPL_SERIES).map((kind) => [kind, new Set()]));

  for (const fdGame of scheduleGames) {
    const fixtureKey = fixtureKeyFromFdName(fdGame.name);
    if (!fixtureKey) continue;
    const alreadyScored = ((fdGame.score?.home ?? 0) + (fdGame.score?.away ?? 0)) > 0;
    for (const kind of Object.keys(tickers)) {
      if (alreadyScored && (kind === 'firstGoal' || kind === 'ftts')) continue;
      const event = pickKalshiEvent(indexes[kind].get(fixtureKey), fdGame.openDate);
      if (event?.event_ticker) tickers[kind].add(event.event_ticker);
    }
  }

  return tickers;
}

function fetchOneKalshiGame(fdGame, indexes, marketsByKind) {
  const base = {
    eventId: fdGame.eventId,
    name: fdGame.name,
    openDate: fdGame.openDate,
    inPlay: fdGame.inPlay,
    score: fdGame.score,
    scoreDisplay: fdGame.scoreDisplay,
    teams: fdGame.teams,
  };

  const score = fdGame.score ?? { home: 0, away: 0 };
  const stillFirstGoal = (score.home ?? 0) + (score.away ?? 0) === 0;
  const noGoalMarkets = emptyNoGoalMarkets();

  const fixtureKey = fixtureKeyFromFdName(fdGame.name);
  if (!fixtureKey) {
    return { ...base, noGoalMarkets, error: 'Could not parse fixture name' };
  }

  const pick = (kind) => pickKalshiEvent(indexes[kind]?.get(fixtureKey), fdGame.openDate);
  const marketsFor = (kind, event) => (
    event ? (marketsByKind[kind]?.get(event.event_ticker) ?? []) : []
  );

  const totalEvent = pick('total');
  const scoreEvent = pick('score');
  const firstGoalEvent = pick('firstGoal');
  const fttsEvent = pick('ftts');

  if (totalEvent) {
    noGoalMarkets.totalGoalsUnder = extractTotalGoalsUnder(marketsFor('total', totalEvent), score);
  }

  if (scoreEvent) {
    noGoalMarkets.correctScore = extractCorrectScore(marketsFor('score', scoreEvent), score);
  }

  if (stillFirstGoal) {
    noGoalMarkets.nextGoalscorer = extractNoGoalscorer(marketsFor('firstGoal', firstGoalEvent));
    const noFirstGoal = extractNoFirstTeamToScore(marketsFor('ftts', fttsEvent));
    if (noFirstGoal?.american != null) {
      noGoalMarkets.nthGoalNeither = noFirstGoal;
      if (noGoalMarkets.nextGoalMethod == null) {
        noGoalMarkets.nextGoalMethod = { ...noFirstGoal, selection: 'No Goal' };
      }
    }
  }

  if (!totalEvent && !scoreEvent && !firstGoalEvent && !fttsEvent) {
    return { ...base, noGoalMarkets, error: 'Kalshi event not found' };
  }

  return {
    ...base,
    noGoalMarkets,
    kalshiEventTickers: {
      total: totalEvent?.event_ticker ?? null,
      score: scoreEvent?.event_ticker ?? null,
      firstGoal: firstGoalEvent?.event_ticker ?? null,
      ftts: fttsEvent?.event_ticker ?? null,
    },
    error: klshHasNoGoalData(noGoalMarkets) ? null : 'No Kalshi no-goal lines for current score',
  };
}

async function fetchWorldCupKalshiOddsInner({ upcomingOnly = true } = {}) {
  const fdPayload = await fetchFanDuelGames();
  const scheduleGames = upcomingOnly
    ? fdPayload.games.filter(isUpcomingGame)
    : fdPayload.games;

  const seriesEntries = await Promise.all(
    Object.entries(EPL_SERIES).map(async ([kind, ticker]) => [kind, await fetchAllKalshiEvents(ticker)]),
  );
  const eventsByKind = Object.fromEntries(seriesEntries);
  const indexes = Object.fromEntries(
    Object.entries(eventsByKind).map(([kind, events]) => [kind, buildKalshiEventIndex(events)]),
  );
  const tickers = collectNeededEventTickers(scheduleGames, indexes);
  const marketEntries = await Promise.all(
    Object.entries(tickers).map(async ([kind, set]) => [kind, await loadMarketsForTickers(set)]),
  );
  const marketsByKind = Object.fromEntries(marketEntries);

  const results = scheduleGames.map((fdGame) =>
    fetchOneKalshiGame(fdGame, indexes, marketsByKind),
  );

  results.sort((a, b) => {
    if (!a.openDate) return 1;
    if (!b.openDate) return -1;
    return new Date(a.openDate) - new Date(b.openDate);
  });

  const withOdds = results.filter((g) => klshHasNoGoalData(g.noGoalMarkets)).length;

  return {
    fetchedAt: new Date().toISOString(),
    stats: {
      total: results.length,
      totalEvents: eventsByKind.total.length,
      scoreEvents: eventsByKind.score.length,
      firstGoalEvents: eventsByKind.firstGoal.length,
      fttsEvents: eventsByKind.ftts.length,
      marketFetches: Object.values(tickers).reduce((sum, set) => sum + set.size, 0),
      withOdds,
    },
    games: results,
  };
}

export async function fetchWorldCupKalshiOdds(options = {}) {
  const cacheKey = options.upcomingOnly === false ? 'all' : 'upcoming';
  const now = Date.now();

  if (responseCache.key === cacheKey && now - responseCache.at < KALSHI_RESPONSE_CACHE_MS) {
    return responseCache.data;
  }

  if (responseCache.inflight?.key === cacheKey) {
    return responseCache.inflight.promise;
  }

  const promise = fetchWorldCupKalshiOddsInner(options);
  responseCache.inflight = { key: cacheKey, promise };

  try {
    const data = await promise;
    responseCache = { key: cacheKey, at: Date.now(), data, inflight: null };
    return data;
  } catch (err) {
    responseCache.inflight = null;
    if (responseCache.key === cacheKey && responseCache.data) {
      return {
        ...responseCache.data,
        fetchedAt: responseCache.data.fetchedAt,
        stale: true,
        staleError: err.message,
      };
    }
    throw err;
  }
}

function wantsCornersBook(req) {
  const q = req.query || {};
  if (q.book === 'corners' || q.corners === '1') return true;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams.get('book') === 'corners';
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (wantsCornersBook(req)) {
    const { default: cornersHandler } = await import('../lib/kalshi-corners.mjs');
    return cornersHandler(req, res);
  }

  try {
    const upcomingOnly = req.query?.all !== '1' && req.query?.all !== 'true';
    const data = await fetchWorldCupKalshiOdds({ upcomingOnly });
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[kalshi-sop]', err);
    return res.status(502).json({ error: err.message || 'Kalshi fetch failed' });
  }
}
