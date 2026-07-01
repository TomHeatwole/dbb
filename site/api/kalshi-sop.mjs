/**
 * Kalshi World Cup no-goal proxy scraper.
 * Maps KXWCTOTAL (Under via NO on Over) and KXWCSCORE (exact score YES) to SOP keys.
 */

import { fetchWorldCupSopOdds as fetchFanDuelGames } from './fanduel-sop.mjs';
import { probToAmerican } from '../src/sop/sopModel.js';

const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';

const WC_SERIES = {
  total: 'KXWCTOTAL',
  score: 'KXWCSCORE',
};

const KALSHI_MIN_INTERVAL_MS = Number(process.env.KALSHI_MIN_INTERVAL_MS || 300);
const KALSHI_RESPONSE_CACHE_MS = Number(process.env.KALSHI_RESPONSE_CACHE_MS || 30_000);
const KALSHI_EVENTS_CACHE_MS = Number(process.env.KALSHI_EVENTS_CACHE_MS || 5 * 60_000);
const KALSHI_MARKETS_CACHE_MS = Number(process.env.KALSHI_MARKETS_CACHE_MS || 30_000);
const KALSHI_MAX_RETRIES = Number(process.env.KALSHI_MAX_RETRIES || 6);

const TEAM_ALIASES = {
  'congo dr': 'dr congo',
  'democratic republic of the congo': 'dr congo',
  'cote divoire': 'ivory coast',
  'côte d\'ivoire': 'ivory coast',
  'cote d\'ivoire': 'ivory coast',
  'republic of korea': 'south korea',
  'korea republic': 'south korea',
  'turkiye': 'turkey',
  'czechia': 'czech republic',
  'curacao': 'curacao',
  'curaçao': 'curacao',
  'usa': 'united states',
  'u.s.a.': 'united states',
  'bosnia and herzegovina': 'bosnia',
};

/** Serialize Kalshi HTTP calls with spacing to avoid 429 bursts. */
let kalshiQueue = Promise.resolve();
let lastKalshiRequestAt = 0;

const eventsCache = new Map();
const marketsCache = new Map();
let responseCache = { key: null, at: 0, data: null, inflight: null };

function normalizeTeamName(name) {
  let s = String(name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return TEAM_ALIASES[s] ?? s;
}

function fixtureKeyFromTeams(home, away) {
  const pair = [normalizeTeamName(home), normalizeTeamName(away)].sort();
  return pair.join('|');
}

function fixtureKeyFromFdName(name) {
  const parts = String(name ?? '').split(/\s+v\s+/i);
  if (parts.length !== 2) return null;
  return fixtureKeyFromTeams(parts[0].trim(), parts[1].trim());
}

function parseKalshiFixture(title) {
  const m = String(title ?? '').match(/^(.+?)\s+vs\s+(.+?):/i);
  if (!m) return null;
  return fixtureKeyFromTeams(m[1].trim(), m[2].trim());
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

async function fetchAllKalshiEvents(seriesTicker) {
  const cached = readCacheEntry(eventsCache, seriesTicker, KALSHI_EVENTS_CACHE_MS);
  if (cached) return cached;

  const events = [];
  let cursor = null;

  do {
    const qs = new URLSearchParams({ series_ticker: seriesTicker, limit: '200' });
    if (cursor) qs.set('cursor', cursor);
    const payload = await kalshiFetch(`/events?${qs}`);
    events.push(...(payload.events ?? []));
    cursor = payload.cursor || null;
    if (!cursor || !(payload.events ?? []).length) break;
  } while (cursor);

  writeCacheEntry(eventsCache, seriesTicker, events);
  return events;
}

async function fetchMarketsForEvent(eventTicker) {
  const cached = readCacheEntry(marketsCache, eventTicker, KALSHI_MARKETS_CACHE_MS);
  if (cached) return cached;

  const qs = new URLSearchParams({ event_ticker: eventTicker, limit: '100' });
  const payload = await kalshiFetch(`/markets?${qs}`);
  const markets = payload.markets ?? [];
  writeCacheEntry(marketsCache, eventTicker, markets);
  return markets;
}

async function loadMarketsForTickers(tickers) {
  const byEvent = new Map();
  for (const ticker of tickers) {
    byEvent.set(ticker, await fetchMarketsForEvent(ticker));
  }
  return byEvent;
}

function kalshiAskToAmerican(askDollars) {
  const price = Number(askDollars);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
  return probToAmerican(price);
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

function extractCorrectScore(markets, score) {
  const key = scoreKey(score);
  const home = String(score.home);
  const away = String(score.away);

  const market = (markets ?? []).find((m) => {
    const strike = m.custom_strike ?? {};
    return String(strike.home_score) === home && String(strike.away_score) === away;
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
    byFixture.set(key, event);
  }
  return byFixture;
}

function isUpcomingGame(game) {
  if (game.inPlay) return false;
  if (!game.openDate) return true;
  return new Date(game.openDate) > new Date();
}

function klshHasNoGoalData(noGoalMarkets) {
  if (!noGoalMarkets) return false;
  return Object.values(noGoalMarkets).some((q) => q?.american != null);
}

function collectNeededEventTickers(scheduleGames, totalEventIndex, scoreEventIndex) {
  const totalTickers = new Set();
  const scoreTickers = new Set();

  for (const fdGame of scheduleGames) {
    const fixtureKey = fixtureKeyFromFdName(fdGame.name);
    if (!fixtureKey) continue;
    const totalEvent = totalEventIndex.get(fixtureKey);
    const scoreEvent = scoreEventIndex.get(fixtureKey);
    if (totalEvent?.event_ticker) totalTickers.add(totalEvent.event_ticker);
    if (scoreEvent?.event_ticker) scoreTickers.add(scoreEvent.event_ticker);
  }

  return { totalTickers, scoreTickers };
}

function fetchOneKalshiGame(fdGame, totalEventIndex, scoreEventIndex, totalByEvent, scoreByEvent) {
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
  const noGoalMarkets = emptyNoGoalMarkets();

  const fixtureKey = fixtureKeyFromFdName(fdGame.name);
  if (!fixtureKey) {
    return { ...base, noGoalMarkets, error: 'Could not parse fixture name' };
  }

  const totalEvent = totalEventIndex.get(fixtureKey);
  const scoreEvent = scoreEventIndex.get(fixtureKey);

  if (totalEvent) {
    noGoalMarkets.totalGoalsUnder = extractTotalGoalsUnder(
      totalByEvent.get(totalEvent.event_ticker) ?? [],
      score,
    );
  }

  if (scoreEvent) {
    noGoalMarkets.correctScore = extractCorrectScore(
      scoreByEvent.get(scoreEvent.event_ticker) ?? [],
      score,
    );
  }

  if (!totalEvent && !scoreEvent) {
    return { ...base, noGoalMarkets, error: 'Kalshi event not found' };
  }

  return {
    ...base,
    noGoalMarkets,
    kalshiEventTickers: {
      total: totalEvent?.event_ticker ?? null,
      score: scoreEvent?.event_ticker ?? null,
    },
    error: klshHasNoGoalData(noGoalMarkets) ? null : 'No Kalshi no-goal lines for current score',
  };
}

async function fetchWorldCupKalshiOddsInner({ upcomingOnly = true } = {}) {
  const fdPayload = await fetchFanDuelGames();
  const scheduleGames = upcomingOnly
    ? fdPayload.games.filter(isUpcomingGame)
    : fdPayload.games;

  const totalEvents = await fetchAllKalshiEvents(WC_SERIES.total);
  const scoreEvents = await fetchAllKalshiEvents(WC_SERIES.score);

  const totalEventIndex = buildKalshiEventIndex(totalEvents);
  const scoreEventIndex = buildKalshiEventIndex(scoreEvents);
  const { totalTickers, scoreTickers } = collectNeededEventTickers(
    scheduleGames,
    totalEventIndex,
    scoreEventIndex,
  );

  const totalByEvent = await loadMarketsForTickers(totalTickers);
  const scoreByEvent = await loadMarketsForTickers(scoreTickers);

  const results = scheduleGames.map((fdGame) =>
    fetchOneKalshiGame(fdGame, totalEventIndex, scoreEventIndex, totalByEvent, scoreByEvent),
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
      totalEvents: totalEvents.length,
      scoreEvents: scoreEvents.length,
      marketFetches: totalTickers.size + scoreTickers.size,
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
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
