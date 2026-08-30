/**
 * ESPN Premier League scoreboard — clock, period, and live score (no API key).
 * Scoreboard only; play-by-play / stoppage estimates stay in pl-corners.
 */

const ESPN_SCOREBOARD_URLS = [
  'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
  'https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
];

const ESPN_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: 'https://www.espn.com/soccer/scoreboard/_/league/eng.1',
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

export function namesMatch(a, b) {
  const ca = canonTeam(a);
  const cb = canonTeam(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

export function compactEspnError(err) {
  const s = String(err ?? '');
  if (/Access Denied/i.test(s) || /\b403\b/.test(s)) return '403 from ESPN';
  if (/401/.test(s)) return '401 unauthorized';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function parseEspnClock(display) {
  const s = String(display ?? '').trim();
  const m = s.match(/^(\d+)'(?:\+(\d+)')?$/);
  if (!m) {
    return { display: s || null, elapsed: null, plus: 0, inStoppage: false };
  }
  const elapsed = Number(m[1]);
  const plus = Number(m[2] || 0);
  return {
    display: s,
    elapsed,
    plus,
    inStoppage: plus > 0 || Boolean(m[2]),
  };
}

function currentPeriodFromStatus(status, clock) {
  const period = Number(status?.period);
  if (Number.isFinite(period) && period > 0) return period;
  const name = String(status?.type?.name ?? status?.type?.description ?? '');
  if (/HALFTIME/i.test(name)) return 1;
  if (clock?.elapsed != null) return clock.elapsed <= 45 ? 1 : 2;
  return null;
}

function isFinishedEspnStatus(status) {
  return String(status?.type?.state ?? '').toLowerCase() === 'post';
}

function isHalftimeEspnStatus(status) {
  const bits = [
    status?.type?.name,
    status?.type?.description,
    status?.type?.detail,
    status?.type?.shortDetail,
  ].filter(Boolean).join(' ');
  return /HALF[\s_-]?TIME/i.test(bits) || /STATUS_HALFTIME/i.test(bits);
}

function competitorsFromEspnEvent(event) {
  const competition = event?.competitions?.[0] ?? {};
  const competitors = competition.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const score = (row) => {
    const n = Number(row?.score);
    return Number.isFinite(n) ? n : null;
  };
  return {
    home: home?.team?.displayName ?? home?.team?.name ?? null,
    away: away?.team?.displayName ?? away?.team?.name ?? null,
    homeScore: score(home),
    awayScore: score(away),
  };
}

export function extractEspnClock(event) {
  const competition = event?.competitions?.[0] ?? {};
  const status = competition.status ?? {};
  const teams = competitorsFromEspnEvent(event);
  const parsed = parseEspnClock(status.displayClock);
  const period = currentPeriodFromStatus(status, parsed);
  const finished = isFinishedEspnStatus(status);
  const halfTime = isHalftimeEspnStatus(status) && !finished;
  const matchStatus = status.type?.description ?? status.type?.detail ?? status.type?.name ?? null;

  let clock = parsed.display;
  if (halfTime) clock = 'HT';
  else if (finished) clock = clock && clock !== '0\'' ? clock : 'FT';

  return {
    clock,
    elapsed: halfTime ? 45 : parsed.elapsed,
    plus: halfTime ? 0 : parsed.plus,
    inStoppage: halfTime ? false : parsed.inStoppage,
    period: halfTime ? 1 : period,
    halfTime,
    finished,
    matchStatus: halfTime ? (matchStatus || 'Halftime') : matchStatus,
    status: status.type?.state ?? null,
    homeScore: teams.homeScore,
    awayScore: teams.awayScore,
    source: 'espn',
  };
}

function yyyymmddFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function yyyymmddInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}${month}${day}`;
}

function uniqueScoreboardDates(openDates) {
  const dates = new Set();
  const now = new Date();
  dates.add(yyyymmddInTimeZone(now, 'UTC'));
  dates.add(yyyymmddInTimeZone(now, 'Europe/London'));
  dates.add(yyyymmddInTimeZone(now, 'America/New_York'));
  for (const iso of openDates) {
    const key = yyyymmddFromIso(iso);
    if (key) dates.add(key);
  }
  return [...dates].filter(Boolean).slice(0, 8);
}

async function espnGetJson(url) {
  const res = await fetch(url, { headers: ESPN_HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ESPN ${url} returned ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
  }
  return res.json();
}

let espnScoreboardBase = null;

async function espnGetScoreboard(dates) {
  const suffix = dates ? `?dates=${dates}` : '';
  const bases = espnScoreboardBase
    ? [espnScoreboardBase, ...ESPN_SCOREBOARD_URLS.filter((url) => url !== espnScoreboardBase)]
    : ESPN_SCOREBOARD_URLS;
  let lastErr = null;
  for (const base of bases) {
    try {
      const payload = await espnGetJson(`${base}${suffix}`);
      espnScoreboardBase = base;
      return payload;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('ESPN scoreboard fetch failed');
}

function summarizeEspnEvent(event) {
  const teams = competitorsFromEspnEvent(event);
  return {
    id: event?.id ?? event?.competitions?.[0]?.id ?? null,
    teams: { home: teams.home, away: teams.away },
    startTime: event?.date ?? event?.competitions?.[0]?.date ?? null,
    clock: extractEspnClock(event),
  };
}

export async function fetchEspnPlScoreboard(openDates = []) {
  try {
    const dates = uniqueScoreboardDates(openDates);
    const payloads = await Promise.all(
      dates.map(async (date) => {
        try {
          return await espnGetScoreboard(date);
        } catch (err) {
          return { __error: err, date };
        }
      }),
    );

    const eventsById = new Map();
    const scoreboardErrors = [];
    for (const payload of payloads) {
      if (payload?.__error) {
        scoreboardErrors.push(`${payload.date}: ${payload.__error.message}`);
        continue;
      }
      for (const event of payload?.events ?? []) {
        if (event?.id) eventsById.set(String(event.id), event);
      }
    }

    if (!eventsById.size) {
      const err = scoreboardErrors[0] || 'ESPN scoreboard returned no Premier League games';
      return { ok: false, error: err, matches: [] };
    }

    const matches = [...eventsById.values()].map(summarizeEspnEvent);
    const livePremierLeague = matches.filter(
      (m) => m.clock?.status === 'in' || m.clock?.halfTime,
    ).length;

    return {
      ok: true,
      error: null,
      matches,
      livePremierLeague,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'ESPN fetch failed',
      matches: [],
    };
  }
}

export function findEspnMatch(game, matches) {
  const home = game.teams?.home;
  const away = game.teams?.away;
  if (!home || !away) return null;
  return (matches ?? []).find(
    (m) => namesMatch(home, m.teams.home) && namesMatch(away, m.teams.away),
  ) ?? null;
}

function clockIsUseful(clock) {
  if (!clock) return false;
  return clock.status === 'in' || clock.status === 'post' || clock.halfTime;
}

export function attachEspnClock(game, matches) {
  if (game.error) return { ...game, espn: null };
  const hit = findEspnMatch(game, matches);
  const clock = hit?.clock;
  if (!clockIsUseful(clock)) return { ...game, espn: null };

  return {
    ...game,
    espn: clock,
    espnId: hit.id,
    score: clock.homeScore != null
      ? { home: clock.homeScore, away: clock.awayScore ?? 0 }
      : game.score,
    scoreDisplay: clock.homeScore != null
      ? `${clock.homeScore}-${clock.awayScore ?? 0}`
      : game.scoreDisplay,
  };
}
