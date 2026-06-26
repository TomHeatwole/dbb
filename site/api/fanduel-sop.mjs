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

const GOAL_METHOD_MARKET = 'Next Goal Method';
const CORRECT_SCORE_MARKET = 'Correct Score';
const NTH_GOAL_ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const GOAL_TYPE_RUNNERS = {
  sop: 'Shot Open Play',
  header: 'Header',
  pk: 'Penalty',
  fk: 'Free Kick',
  og: 'Own Goal',
};

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

function findMarketByName(markets, name) {
  return Object.values(markets).find((m) => m.marketName === name) ?? null;
}

function findRunnerByName(market, name) {
  if (!market) return null;
  const target = String(name).toLowerCase();
  return runnersList(market).find((r) => String(r.runnerName ?? '').toLowerCase() === target) ?? null;
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

  return { home: 0, away: 0 };
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

function nthGoalNeitherRunner(goalNumber) {
  return goalNumber === 1 ? 'No Goals' : 'Neither';
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
  const market = findMarketByName(markets, GOAL_METHOD_MARKET);
  if (!market) return null;

  const out = {};
  for (const [key, runnerName] of Object.entries(GOAL_TYPE_RUNNERS)) {
    const quote = runnerQuote(market, runnerName);
    if (quote) out[key] = quote;
  }
  return Object.keys(out).length ? out : null;
}

function extractNoGoalMarkets(markets, score, teams) {
  const totalGoals = score.home + score.away;
  const nextGoalNumber = totalGoals + 1;
  const underLine = totalGoals + 0.5;
  const scoreKey = scoreDisplay(score);

  const nextGoalMethod = findMarketByName(markets, GOAL_METHOD_MARKET);
  const correctScore = findMarketByName(markets, CORRECT_SCORE_MARKET);
  const totalsMarket = findMarketByName(markets, `Over/Under ${underLine} Goals`);
  const nthGoalMarket = findMarketByName(markets, nthGoalMarketName(nextGoalNumber));

  const underRunner = totalsMarket
    ? runnersList(totalsMarket).find((r) => {
        const rn = String(r.runnerName ?? '').toLowerCase();
        return rn.includes('under') && rn.includes(String(underLine));
      })
    : null;

  const nthRunnerName = nthGoalNeitherRunner(nextGoalNumber);

  return {
    nextGoalMethod: {
      market: GOAL_METHOD_MARKET,
      selection: 'No Goal',
      ...runnerQuote(nextGoalMethod, 'No Goal'),
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
      market: nthGoalMarket?.marketName ?? nthGoalMarketName(nextGoalNumber),
      selection: nthRunnerName,
      goalNumber: nextGoalNumber,
      ...runnerQuote(nthGoalMarket, nthRunnerName),
    },
    meta: {
      score: scoreKey,
      teams,
      totalGoals,
      nextGoalNumber,
    },
  };
}

async function fetchEventBundle(eventId) {
  const tabs = ['quick-bets', 'popular', 'goals'];
  const payloads = await Promise.all(
    tabs.map((tab) => fdFetch(`/event-page?${FD_QUERY}&eventId=${eventId}&tab=${tab}`)),
  );

  const event = mergeEvent(payloads);
  const markets = mergeMarkets(payloads);
  const teams = parseTeams(event?.name);
  const score = parseEventScore(event);

  return {
    event,
    markets,
    teams,
    score,
    goalTypes: extractGoalTypes(markets),
    noGoalMarkets: extractNoGoalMarkets(markets, score, teams),
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
          inPlay: Boolean(bundle.event?.inPlay ?? ev.inPlay),
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
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[fanduel-sop]', err);
    return res.status(502).json({ error: err.message || 'FanDuel fetch failed' });
  }
}
