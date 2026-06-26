/**
 * FanDuel World Cup SOP scraper — no-goal proxies + goal-type odds.
 * Proxies FanDuel's undocumented sbapi — structure can change without notice.
 */

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';
const WC_COMPETITION_ID = 12469077;

const FD_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; HwangDynasty-SOP/1.0)',
};

const GOAL_METHOD_MARKET_PREFIX = 'Next Goal Method';
const CORRECT_SCORE_MARKET = 'Correct Score';
const NTH_GOAL_ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const GOAL_TYPE_RUNNERS = {
  sop: 'Shot Open Play',
  header: 'Header',
  pk: 'Penalty',
  fk: 'Free Kick',
  og: 'Own Goal',
};

const NO_GOAL_RUNNERS = ['No Goal', 'No Goals', 'Neither'];

function runnersList(market) {
  const runners = market?.runners;
  if (!runners) return [];
  if (Array.isArray(runners)) return runners;
  return Object.values(runners);
}

function americanOdds(runner) {
  const raw = runner?.winRunnerOdds?.americanDisplayOdds?.americanOdds;
  return Number.isFinite(raw) ? raw : null;
}

function impliedProbFromAmerican(american) {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function findMarketByName(markets, name) {
  return Object.values(markets).find((m) => m.marketName === name) ?? null;
}

function findMarketByPrefix(markets, prefix) {
  const p = String(prefix).toLowerCase();
  return Object.values(markets).find((m) => String(m.marketName ?? '').toLowerCase().startsWith(p)) ?? null;
}

function findRunnerByName(market, name) {
  if (!market) return null;
  const target = String(name).toLowerCase();
  return runnersList(market).find((r) => String(r.runnerName ?? '').toLowerCase() === target) ?? null;
}

function findRunnerByNames(market, names) {
  for (const name of names) {
    const runner = findRunnerByName(market, name);
    if (runner) return runner;
  }
  return null;
}

function runnerQuote(market, runnerName) {
  const runner = findRunnerByName(market, runnerName);
  if (!runner) return null;
  return {
    american: americanOdds(runner),
    status: runner.runnerStatus ?? null,
    runnerName: runner.runnerName,
  };
}

function runnerQuoteAny(market, runnerNames) {
  const runner = findRunnerByNames(market, runnerNames);
  if (!runner) return null;
  return {
    american: americanOdds(runner),
    status: runner.runnerStatus ?? null,
    runnerName: runner.runnerName,
  };
}

async function fdFetch(path) {
  const res = await fetch(`${FD_BASE}${path}`, { headers: FD_HEADERS });
  if (!res.ok) {
    throw new Error(`FanDuel ${path} returned ${res.status}`);
  }
  return res.json();
}

function wcMatchEvents(payload) {
  const events = payload?.attachments?.events ?? {};
  return Object.entries(events)
    .filter(([, ev]) => ev.competitionId === WC_COMPETITION_ID && String(ev.name ?? '').includes(' v '))
    .map(([id, ev]) => ({
      eventId: Number(id),
      name: ev.name,
      openDate: ev.openDate ?? null,
      inPlay: Boolean(ev.inPlay),
    }));
}

function parseEventScore(event) {
  const candidates = [
    event?.score,
    event?.scores,
    event?.currentScore,
    event?.matchScore,
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'object') {
      const home = Number(c.home ?? c.homeScore ?? c.team1 ?? c[0]);
      const away = Number(c.away ?? c.awayScore ?? c.team2 ?? c[1]);
      if (Number.isFinite(home) && Number.isFinite(away)) {
        return { home, away };
      }
    }
    if (typeof c === 'string') {
      const m = c.match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (m) return { home: Number(m[1]), away: Number(m[2]) };
    }
  }

  return null;
}

function parseTeams(eventName) {
  const parts = String(eventName ?? '').split(' v ');
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0].trim(), away: parts[1].trim() };
}

function scoreDisplay(score) {
  return `${score.home}-${score.away}`;
}

function nthGoalMarketName(goalNumber) {
  const ord = NTH_GOAL_ORDINALS[goalNumber - 1];
  if (!ord) return null;
  return `Team To Score the ${ord} Goal`;
}

function findNthGoalMarket(markets) {
  for (let i = 0; i < NTH_GOAL_ORDINALS.length; i += 1) {
    const goalNumber = i + 1;
    const market = findMarketByName(markets, nthGoalMarketName(goalNumber));
    if (market && market.marketStatus !== 'CLOSED') {
      return { market, goalNumber };
    }
  }
  return { market: null, goalNumber: 1 };
}

function teamHasScoredFromOu(markets, side) {
  const market = findMarketByName(markets, `${side} Team Over/Under 0.5 Goals`);
  if (!market) return null;

  const over = findRunnerByName(market, 'Over');
  const under = findRunnerByName(market, 'Under');
  if (!over || !under) return null;
  if (over.runnerStatus !== 'ACTIVE' || under.runnerStatus !== 'ACTIVE') return null;

  const overProb = impliedProbFromAmerican(americanOdds(over));
  const underProb = impliedProbFromAmerican(americanOdds(under));
  if (overProb == null || underProb == null) return null;

  if (overProb > underProb + 0.03) return true;
  if (underProb > overProb + 0.03) return false;
  return null;
}

function activeCorrectScores(markets) {
  const market = findMarketByName(markets, CORRECT_SCORE_MARKET);
  if (!market) return [];

  return runnersList(market)
    .filter((r) => r.runnerStatus === 'ACTIVE')
    .map((r) => {
      const m = String(r.runnerName ?? '').match(/^(\d+)-(\d+)$/);
      if (!m) return null;
      return {
        home: Number(m[1]),
        away: Number(m[2]),
        key: r.runnerName,
        american: americanOdds(r),
      };
    })
    .filter(Boolean);
}

function inferLiveScore(markets) {
  const { goalNumber } = findNthGoalMarket(markets);
  const totalGoals = Math.max(0, goalNumber - 1);

  if (totalGoals === 0) {
    return { home: 0, away: 0 };
  }

  const homeScored = teamHasScoredFromOu(markets, 'Home');
  const awayScored = teamHasScoredFromOu(markets, 'Away');

  const activeScores = activeCorrectScores(markets).filter(
    (s) => s.home + s.away === totalGoals,
  );

  if (homeScored === true && awayScored === false) {
    return { home: totalGoals, away: 0 };
  }
  if (homeScored === false && awayScored === true) {
    return { home: 0, away: totalGoals };
  }

  if (activeScores.length === 1) {
    return { home: activeScores[0].home, away: activeScores[0].away };
  }

  if (homeScored === true && awayScored === true && totalGoals >= 2) {
    const draw = activeScores.find((s) => s.home === s.away);
    if (draw) return { home: draw.home, away: draw.away };
  }

  if (homeScored === true) {
    return { home: Math.min(totalGoals, 1), away: Math.max(0, totalGoals - 1) };
  }
  if (awayScored === true) {
    return { home: Math.max(0, totalGoals - 1), away: Math.min(totalGoals, 1) };
  }

  return { home: 0, away: totalGoals };
}

function resolveScore(event, markets) {
  const direct = parseEventScore(event);
  if (direct) return direct;

  if (event?.inPlay) {
    return inferLiveScore(markets);
  }

  return { home: 0, away: 0 };
}

function mergeMarkets(payloads) {
  const merged = {};
  for (const payload of payloads) {
    const markets = payload?.attachments?.markets ?? {};
    Object.assign(merged, markets);
  }
  return merged;
}

function mergeEvent(payloads) {
  for (const payload of payloads) {
    const events = payload?.attachments?.events ?? {};
    const values = Object.values(events);
    if (values.length) return values[0];
  }
  return null;
}

function extractGoalTypes(markets) {
  const market = findMarketByPrefix(markets, GOAL_METHOD_MARKET_PREFIX);
  if (!market) return null;

  const out = {};
  for (const [key, runnerName] of Object.entries(GOAL_TYPE_RUNNERS)) {
    const quote = runnerQuote(market, runnerName);
    if (quote) out[key] = quote;
  }
  return Object.keys(out).length ? out : null;
}

function extractNoGoalMarkets(markets, score, teams, inPlay) {
  const totalGoals = score.home + score.away;
  const nextGoalNumber = totalGoals + 1;
  const underLine = totalGoals + 0.5;
  const scoreKey = scoreDisplay(score);

  const nextGoalMethod = findMarketByPrefix(markets, GOAL_METHOD_MARKET_PREFIX);
  const correctScore = findMarketByName(markets, CORRECT_SCORE_MARKET);
  const totalsMarket = findMarketByName(markets, `Over/Under ${underLine} Goals`);
  const { market: nthGoalMarket, goalNumber: nthFromMarket } = findNthGoalMarket(markets);
  const nthGoalNumber = inPlay ? nthFromMarket : nextGoalNumber;

  const underRunner = totalsMarket
    ? runnersList(totalsMarket).find((r) => {
        const rn = String(r.runnerName ?? '').toLowerCase();
        return rn.includes('under') && rn.includes(String(underLine));
      })
    : null;

  const nthRunnerNames = nthGoalNumber === 1
    ? ['No Goals', 'No Goal', 'Neither']
    : ['Neither', 'No Goals', 'No Goal'];

  return {
    nextGoalMethod: {
      market: nextGoalMethod?.marketName ?? GOAL_METHOD_MARKET_PREFIX,
      selection: 'No Goal',
      ...runnerQuoteAny(nextGoalMethod, NO_GOAL_RUNNERS),
    },
    correctScore: {
      market: CORRECT_SCORE_MARKET,
      selection: scoreKey,
      scoreUsed: scoreKey,
      ...runnerQuote(correctScore, scoreKey),
    },
    totalGoalsUnder: {
      market: totalsMarket?.marketName ?? `Over/Under ${underLine} Goals`,
      selection: `Under ${underLine}`,
      line: underLine,
      totalGoals,
      american: underRunner ? americanOdds(underRunner) : null,
      status: underRunner?.runnerStatus ?? null,
      runnerName: underRunner?.runnerName ?? null,
    },
    nthGoalNeither: {
      market: nthGoalMarket?.marketName ?? nthGoalMarketName(nthGoalNumber),
      selection: nthRunnerNames[0],
      goalNumber: nthGoalNumber,
      ...runnerQuoteAny(nthGoalMarket, nthRunnerNames),
    },
    meta: {
      score: scoreKey,
      teams,
      totalGoals,
      nextGoalNumber: nthGoalNumber,
      inPlay,
    },
  };
}

async function fetchEventBundle(eventId) {
  const baseTabs = ['quick-bets', 'popular', 'goals'];
  const payloads = await Promise.all(
    baseTabs.map((tab) => fdFetch(`/event-page?${FD_QUERY}&eventId=${eventId}&tab=${tab}`)),
  );

  const event = mergeEvent(payloads);
  if (event?.inPlay) {
    payloads.push(await fdFetch(`/event-page?${FD_QUERY}&eventId=${eventId}&tab=live`));
  }

  const markets = mergeMarkets(payloads);
  const teams = parseTeams(event?.name);
  const inPlay = Boolean(event?.inPlay);
  const score = resolveScore(event, markets);

  return {
    event,
    markets,
    teams,
    score,
    inPlay,
    goalTypes: extractGoalTypes(markets),
    noGoalMarkets: extractNoGoalMarkets(markets, score, teams, inPlay),
  };
}

export async function fetchWorldCupSopOdds() {
  const sportPage = await fdFetch(`/content-managed-page?${FD_QUERY}&page=SPORT&eventTypeId=1`);
  const events = wcMatchEvents(sportPage);

  const results = await Promise.all(
    events.map(async (ev) => {
      try {
        const bundle = await fetchEventBundle(ev.eventId);
        return {
          ...ev,
          inPlay: bundle.inPlay,
          score: bundle.score,
          scoreDisplay: scoreDisplay(bundle.score),
          teams: bundle.teams,
          goalTypes: bundle.goalTypes,
          noGoalMarkets: bundle.noGoalMarkets,
        };
      } catch (err) {
        return { ...ev, error: err.message };
      }
    }),
  );

  results.sort((a, b) => {
    if (!a.openDate) return 1;
    if (!b.openDate) return -1;
    return new Date(a.openDate) - new Date(b.openDate);
  });

  return {
    fetchedAt: new Date().toISOString(),
    games: results,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await fetchWorldCupSopOdds();
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[fanduel-sop]', err);
    return res.status(502).json({ error: err.message || 'FanDuel fetch failed' });
  }
}
