/**
 * Premier League corner book: FanDuel totals + next 5/10 min lines,
 * plus expected stoppage from Sportradar soccer live timelines.
 */

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';
const PL_COMPETITION_ID = 10932509;
const SR_PL_COMPETITION_ID = 'sr:competition:17';

const FD_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; HwangDynasty-Corners/1.0)',
};

const TEAM_CANON = [
  ['manchester united', 'man utd', 'man united', 'manchester utd'],
  ['manchester city', 'man city'],
  ['tottenham hotspur', 'tottenham', 'spurs'],
  ['nottingham forest', 'nottm forest', "nott'm forest", 'notts forest'],
  ['newcastle united', 'newcastle'],
  ['wolverhampton wanderers', 'wolves', 'wolverhampton'],
  ['brighton hove albion', 'brighton', 'brighton and hove albion', 'brighton & hove albion'],
  ['west ham united', 'west ham'],
  ['crystal palace', 'palace'],
  ['aston villa', 'villa'],
  ['leicester city', 'leicester'],
  ['leeds united', 'leeds'],
  ['ipswich town', 'ipswich'],
  ['afc bournemouth', 'bournemouth'],
  ['sheffield united', 'sheff utd', 'sheffield utd'],
  ['west bromwich albion', 'west brom'],
  ['coventry city', 'coventry'],
  ['hull city', 'hull'],
  ['fulham', 'fulham fc'],
  ['everton', 'everton fc'],
  ['arsenal', 'arsenal fc'],
  ['chelsea', 'chelsea fc'],
  ['liverpool', 'liverpool fc'],
  ['brentford', 'brentford fc'],
  ['sunderland', 'sunderland afc'],
  ['burnley', 'burnley fc'],
];

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

function runnerQuote(runner) {
  if (!runner) return null;
  const american = americanOdds(runner);
  if (american == null) return null;
  return {
    american,
    status: runner.runnerStatus ?? null,
    runnerName: runner.runnerName ?? null,
  };
}

async function fdFetch(path) {
  const res = await fetch(`${FD_BASE}${path}`, { headers: FD_HEADERS });
  if (!res.ok) {
    throw new Error(`FanDuel ${path} returned ${res.status}`);
  }
  return res.json();
}

function parseTeams(eventName) {
  const parts = String(eventName ?? '').split(' v ');
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0].trim(), away: parts[1].trim() };
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

function scoreDisplay(score) {
  if (!score) return '0-0';
  return `${score.home}-${score.away}`;
}

function plMatchEvents(payload) {
  const events = payload?.attachments?.events ?? {};
  return Object.entries(events)
    .filter(([, ev]) => ev.competitionId === PL_COMPETITION_ID && String(ev.name ?? '').includes(' v '))
    .map(([id, ev]) => ({
      eventId: Number(id),
      name: ev.name,
      openDate: ev.openDate ?? null,
      inPlay: Boolean(ev.inPlay),
    }));
}

function mergeMarkets(payloads) {
  const merged = {};
  for (const payload of payloads) {
    Object.assign(merged, payload?.attachments?.markets ?? {});
  }
  return merged;
}

function mergeEvent(payloads) {
  for (const payload of payloads) {
    const values = Object.values(payload?.attachments?.events ?? {});
    if (values.length) return values[0];
  }
  return null;
}

function findOverUnder(market, line) {
  const lineStr = String(line);
  let over = null;
  let under = null;
  for (const runner of runnersList(market)) {
    const name = String(runner.runnerName ?? '').toLowerCase();
    if (!name.includes(lineStr)) continue;
    if (name.startsWith('over')) over = runnerQuote(runner);
    if (name.startsWith('under')) under = runnerQuote(runner);
  }
  return { over, under };
}

function extractTotalCorners(markets) {
  if (!markets) return null;
  const candidates = [];
  for (const market of Object.values(markets)) {
    const match = String(market.marketName ?? '').match(/^Total Corners (\d+\.5)$/i);
    if (!match) continue;
    if (String(market.marketStatus ?? '').toUpperCase() === 'CLOSED') continue;
    const line = Number(match[1]);
    const { over, under } = findOverUnder(market, line);
    if (!over || !under) continue;
    const ip = impliedProbFromAmerican(over.american);
    if (ip == null) continue;
    candidates.push({
      line,
      market: market.marketName,
      over,
      under,
      closeness: Math.abs(ip - 0.5),
    });
  }
  candidates.sort((a, b) => a.closeness - b.closeness);
  if (!candidates[0]) return null;
  const { closeness, ...picked } = candidates[0];
  return picked;
}

function parseWindowBounds(label) {
  const m = String(label ?? '').match(/(\d{1,3}):(\d{2})\s*[-–]\s*(\d{1,3}):(\d{2})/);
  if (!m) return null;
  return {
    startSeconds: Number(m[1]) * 60 + Number(m[2]),
    endSeconds: Number(m[3]) * 60 + Number(m[4]),
  };
}

function clockToSeconds(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 60);
  const s = String(value).trim();
  const m = s.match(/^(\d+)(?::(\d+))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] || 0);
}

function isEitherTeamCornerRunner(name) {
  const n = String(name ?? '');
  if (/either\s+team/i.test(n) && /corner/i.test(n)) return true;
  if (/^\d+\+\s+(?:total\s+)?corners\b/i.test(n)) return true;
  if (/^(over|under)\s+\d+\.5\s+corners\b/i.test(n)) return true;
  return false;
}

function extractWindowSelections(market) {
  const plus = [];
  const overUnder = [];
  const other = [];

  for (const runner of runnersList(market)) {
    const quote = runnerQuote(runner);
    if (!quote) continue;
    const name = String(runner.runnerName ?? '');
    const plusMatch = name.match(/^(\d+)\+\b/);
    const ouMatch = name.match(/^(over|under)\s+(\d+\.5)\b/i);

    if (plusMatch && isEitherTeamCornerRunner(name)) {
      plus.push({ n: Number(plusMatch[1]), ...quote });
      continue;
    }
    if (ouMatch && /corner/i.test(name)) {
      overUnder.push({
        side: ouMatch[1].toLowerCase(),
        line: Number(ouMatch[2]),
        ...quote,
      });
      continue;
    }
    if (/corner/i.test(name)) {
      other.push(quote);
    }
  }

  plus.sort((a, b) => a.n - b.n);
  return {
    plus,
    overUnder,
    other: plus.length || overUnder.length ? [] : other.slice(0, 8),
  };
}

function summarizeWindowMarket(market, minutes) {
  const name = String(market.marketName ?? '');
  const windowMatch = name.match(/\(([^)]+)\)/);
  const window = windowMatch ? windowMatch[1].replace(/\s+/g, '') : null;
  return {
    minutes,
    window,
    market: name,
    status: market.marketStatus ?? null,
    ...extractWindowSelections(market),
  };
}

function pickWindowMarket(markets, minutes, clockPlayed) {
  if (!markets) return null;
  const re = new RegExp(`(?:match\\s+)?corners?\\s+in\\s+${minutes}\\s+minutes?`, 'i');
  const nextRe = new RegExp(`next\\s+${minutes}\\s+(?:min(?:ute)?s?)\\s+corners?`, 'i');
  const matches = [];

  for (const market of Object.values(markets)) {
    const name = String(market.marketName ?? '');
    if (!re.test(name) && !nextRe.test(name)) continue;
    if (String(market.marketStatus ?? '').toUpperCase() === 'CLOSED') continue;
    const windowMatch = name.match(/\(([^)]+)\)/);
    const bounds = parseWindowBounds(windowMatch?.[1]);
    matches.push({ market, bounds, start: bounds?.startSeconds ?? -1 });
  }

  if (!matches.length) return null;

  const clockSeconds = clockToSeconds(clockPlayed);
  if (clockSeconds != null) {
    const containing = matches.filter(
      (m) => m.bounds && clockSeconds >= m.bounds.startSeconds && clockSeconds <= m.bounds.endSeconds,
    );
    if (containing.length) {
      containing.sort((a, b) => b.start - a.start);
      return summarizeWindowMarket(containing[0].market, minutes);
    }
  }

  matches.sort((a, b) => b.start - a.start);
  return summarizeWindowMarket(matches[0].market, minutes);
}

async function fetchEventBundle(eventId) {
  const tabs = ['corners', 'quick-bets'];
  const payloads = await Promise.all(
    tabs.map((tab) => fdFetch(`/event-page?${FD_QUERY}&eventId=${eventId}&tab=${tab}`)),
  );
  const event = mergeEvent(payloads);
  if (event?.inPlay) {
    payloads.push(await fdFetch(`/event-page?${FD_QUERY}&eventId=${eventId}&tab=live`));
  }
  return {
    event,
    markets: mergeMarkets(payloads),
  };
}

function canonTeam(name) {
  const raw = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s&']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  for (const [canon, ...alts] of TEAM_CANON) {
    if (raw === canon || alts.includes(raw)) return canon;
  }
  return raw.replace(/\s+fc$/, '').replace(/^afc\s+/, '').trim();
}

function namesMatch(a, b) {
  const ca = canonTeam(a);
  const cb = canonTeam(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

function competitorsFromSportEvent(sportEvent) {
  const competitors = sportEvent?.competitors ?? [];
  const home = competitors.find((c) => c.qualifier === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.qualifier === 'away') ?? competitors[1];
  return {
    home: home?.name ?? null,
    away: away?.name ?? null,
  };
}

function competitionIdOf(sportEvent) {
  return (
    sportEvent?.sport_event_context?.competition?.id
    ?? sportEvent?.tournament?.id
    ?? sportEvent?.competition?.id
    ?? null
  );
}

function latestInjuryTime(timeline, matchStatus) {
  if (!Array.isArray(timeline)) return null;
  const periodHint = String(matchStatus ?? '');
  const preferSecond = /2nd|second/i.test(periodHint);
  const preferFirst = /1st|first/i.test(periodHint);

  let latest = null;
  for (const ev of timeline) {
    if (ev?.injury_time_announced == null && ev?.type !== 'injury_time_shown') continue;
    const minutes = ev.injury_time_announced;
    if (!Number.isFinite(minutes)) continue;
    const matchClock = String(ev.match_clock ?? '');
    const clockMinute = Number(matchClock.split(':')[0]);
    const inSecond =
      Number(ev.period) === 2
      || Number(ev.match_time) >= 45
      || (Number.isFinite(clockMinute) && clockMinute >= 45);
    if (preferSecond && !inSecond) continue;
    if (preferFirst && inSecond) continue;
    latest = minutes;
  }
  return latest;
}

function formatClockLabel(seconds) {
  if (seconds == null) return null;
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (s === 0) return `${m}'`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extractStoppage(status, timeline) {
  const clock = status?.clock ?? {};
  const announcedSeconds = clockToSeconds(clock.stoppage_time_announced);
  const playedSeconds = clockToSeconds(clock.stoppage_time_played);
  const injuryMinutes = latestInjuryTime(timeline, status?.match_status);
  const injurySeconds = Number.isFinite(injuryMinutes) ? injuryMinutes * 60 : null;
  const expectedSeconds = announcedSeconds ?? injurySeconds;
  const remainingSeconds =
    expectedSeconds != null && playedSeconds != null
      ? Math.max(0, expectedSeconds - playedSeconds)
      : expectedSeconds;

  return {
    matchStatus: status?.match_status ?? null,
    status: status?.status ?? null,
    clock: clock.played ?? null,
    announced: clock.stoppage_time_announced ?? (injuryMinutes != null ? `${injuryMinutes}:00` : null),
    played: clock.stoppage_time_played ?? null,
    expectedMinutes: expectedSeconds != null ? expectedSeconds / 60 : null,
    remainingLabel: formatClockLabel(remainingSeconds),
    expectedLabel: formatClockLabel(expectedSeconds),
    playedLabel: formatClockLabel(playedSeconds),
    homeScore: status?.home_score ?? null,
    awayScore: status?.away_score ?? null,
  };
}

async function srFetch(path) {
  const apiKey = process.env.SPORTRADAR_API_KEY;
  const access = process.env.SPORTRADAR_ACCESS_LEVEL || 'trial';
  const url = new URL(`https://api.sportradar.com/soccer/${access}/v4/en/${path}`);
  url.searchParams.set('api_key', apiKey);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-api-key': apiKey,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sportradar ${path} returned ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
  }
  return res.json();
}

async function fetchSportradarStoppage() {
  const apiKey = process.env.SPORTRADAR_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      error: 'SPORTRADAR_API_KEY is not set',
      matches: [],
    };
  }

  try {
    const [timelinesPayload, summariesPayload] = await Promise.all([
      srFetch('schedules/live/timelines.json'),
      srFetch('schedules/live/summaries.json'),
    ]);

    const timelines = new Map();
    for (const row of timelinesPayload?.sport_event_timelines ?? []) {
      if (row?.id) timelines.set(row.id, row);
    }

    const matches = [];
    for (const summary of summariesPayload?.summaries ?? []) {
      const sportEvent = summary.sport_event;
      if (competitionIdOf(sportEvent) !== SR_PL_COMPETITION_ID) continue;
      const id = sportEvent?.id;
      const timelineRow = timelines.get(id);
      const status = timelineRow?.sport_event_status ?? summary.sport_event_status ?? {};
      const teams = competitorsFromSportEvent(sportEvent);
      matches.push({
        id,
        teams,
        startTime: sportEvent?.start_time ?? timelineRow?.start_time ?? null,
        stoppage: extractStoppage(status, timelineRow?.timeline ?? []),
      });
    }

    return {
      ok: true,
      configured: true,
      error: null,
      matches,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err.message || 'Sportradar fetch failed',
      matches: [],
    };
  }
}

function attachStoppage(game, srMatches) {
  if (game.error || !game._markets) return { ...game, stoppage: null };
  const home = game.teams?.home;
  const away = game.teams?.away;
  if (!home || !away) return { ...game, stoppage: null };

  const hit = srMatches.find(
    (m) => namesMatch(home, m.teams.home) && namesMatch(away, m.teams.away),
  );
  if (!hit) return { ...game, stoppage: null };

  const clockPlayed = hit.stoppage?.clock;
  return {
    ...game,
    stoppage: hit.stoppage,
    sportradarId: hit.id,
    next5: pickWindowMarket(game._markets, 5, clockPlayed) ?? game.next5,
    next10: pickWindowMarket(game._markets, 10, clockPlayed) ?? game.next10,
    score: hit.stoppage?.homeScore != null
      ? { home: hit.stoppage.homeScore, away: hit.stoppage.awayScore ?? 0 }
      : game.score,
    scoreDisplay: hit.stoppage?.homeScore != null
      ? `${hit.stoppage.homeScore}-${hit.stoppage.awayScore ?? 0}`
      : game.scoreDisplay,
  };
}

async function fetchPlCornerBook() {
  const sportPage = await fdFetch(`/content-managed-page?${FD_QUERY}&page=SPORT&eventTypeId=1`);
  const events = plMatchEvents(sportPage);

  const [fdGames, sr] = await Promise.all([
    Promise.all(
      events.map(async (ev) => {
        try {
          const bundle = await fetchEventBundle(ev.eventId);
          const teams = parseTeams(bundle.event?.name ?? ev.name);
          const inPlay = Boolean(bundle.event?.inPlay ?? ev.inPlay);
          const score = parseEventScore(bundle.event) ?? { home: 0, away: 0 };
          return {
            ...ev,
            inPlay,
            name: bundle.event?.name ?? ev.name,
            teams,
            score,
            scoreDisplay: scoreDisplay(score),
            total: extractTotalCorners(bundle.markets),
            next5: pickWindowMarket(bundle.markets, 5, null),
            next10: pickWindowMarket(bundle.markets, 10, null),
            _markets: bundle.markets,
          };
        } catch (err) {
          return { ...ev, error: err.message, stoppage: null };
        }
      }),
    ),
    fetchSportradarStoppage(),
  ]);

  const games = fdGames
    .map((game) => {
      const merged = attachStoppage(game, sr.matches);
      const { _markets, ...rest } = merged;
      return rest;
    })
    .sort((a, b) => {
      if (a.inPlay !== b.inPlay) return a.inPlay ? -1 : 1;
      if (!a.openDate) return 1;
      if (!b.openDate) return -1;
      return new Date(a.openDate) - new Date(b.openDate);
    });

  return {
    fetchedAt: new Date().toISOString(),
    games,
    sportradar: {
      ok: sr.ok,
      configured: sr.configured,
      error: sr.error,
      livePremierLeague: sr.matches.length,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await fetchPlCornerBook();
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pl-corners]', err);
    return res.status(502).json({ error: err.message || 'Premier League corners fetch failed' });
  }
}
