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

async function kalshiFetch(path, attempt = 0) {
  const res = await fetch(`${KALSHI_BASE}${path}`);
  if (res.status === 429 && attempt < 4) {
    await sleep(400 * (attempt + 1));
    return kalshiFetch(path, attempt + 1);
  }
  if (!res.ok) {
    const snippet = await res.text().catch(() => '');
    throw new Error(`Kalshi ${path} returned ${res.status}${snippet ? `: ${snippet.slice(0, 120)}` : ''}`);
  }
  return res.json();
}

async function fetchAllKalshiEvents(seriesTicker) {
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

  return events;
}

async function fetchAllKalshiMarkets(seriesTicker) {
  const markets = [];
  let cursor = null;

  do {
    const qs = new URLSearchParams({ series_ticker: seriesTicker, limit: '200' });
    if (cursor) qs.set('cursor', cursor);
    const payload = await kalshiFetch(`/markets?${qs}`);
    markets.push(...(payload.markets ?? []));
    cursor = payload.cursor || null;
    if (!cursor || !(payload.markets ?? []).length) break;
  } while (cursor);

  return markets;
}

function groupMarketsByEvent(markets) {
  const byEvent = new Map();
  for (const market of markets) {
    const key = market.event_ticker;
    if (!key) continue;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(market);
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

export async function fetchWorldCupKalshiOdds({ upcomingOnly = true } = {}) {
  const fdPayload = await fetchFanDuelGames();
  const scheduleGames = upcomingOnly
    ? fdPayload.games.filter(isUpcomingGame)
    : fdPayload.games;

  const totalEvents = await fetchAllKalshiEvents(WC_SERIES.total);
  const scoreEvents = await fetchAllKalshiEvents(WC_SERIES.score);
  const totalMarkets = await fetchAllKalshiMarkets(WC_SERIES.total);
  const scoreMarkets = await fetchAllKalshiMarkets(WC_SERIES.score);

  const totalEventIndex = buildKalshiEventIndex(totalEvents);
  const scoreEventIndex = buildKalshiEventIndex(scoreEvents);
  const totalByEvent = groupMarketsByEvent(totalMarkets);
  const scoreByEvent = groupMarketsByEvent(scoreMarkets);

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
      withOdds,
    },
    games: results,
  };
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
