/**
 * Premier League corner book: FanDuel totals + next 5/10 min lines,
 * plus expected stoppage estimated from ESPN play-by-play (no API key).
 *
 * ESPN does not publish an expected-stoppage field. We accumulate delay from
 * live events (goals, substitutions, cards, injuries/VAR) in the current half.
 */

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';
const PL_COMPETITION_ID = 10932509;

const ESPN_SCOREBOARD_URLS = [
  'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
  'https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
];
const ESPN_PLAYS_URL =
  'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events';
const ESPN_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: 'https://www.espn.com/soccer/scoreboard/_/league/eng.1',
};

const STOPPAGE_SEC = {
  goal: 30,
  yellow: 20,
  red: 60,
  subStop: 20,
  varReview: 60,
  penalty: 15,
  delayFallback: 30,
  baseFirst: 15,
  baseSecond: 30,
};
const ESPN_PLAYS_LIMIT = 300;
const ESPN_PLAYS_MAX_PAGES = 8;

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

function pickClosestOverUnderMarket(markets, nameRe) {
  if (!markets) return null;
  const candidates = [];
  for (const market of Object.values(markets)) {
    const name = String(market.marketName ?? '');
    const match = name.match(nameRe);
    if (!match) continue;
    if (String(market.marketStatus ?? '').toUpperCase() === 'CLOSED') continue;
    const line = Number(match[1]);
    if (!Number.isFinite(line)) continue;
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

function extractTotalCorners(markets) {
  return pickClosestOverUnderMarket(markets, /^Total Corners (\d+\.5)$/i);
}

function extractFirstHalfCorners(markets) {
  return pickClosestOverUnderMarket(
    markets,
    /^(?:1st|First)\s+Half(?:\s+Total)?\s+Corners (\d+\.5)$/i,
  ) ?? pickClosestOverUnderMarket(
    markets,
    /^Half(?:\s+Time)?\s+Total Corners (\d+\.5)$/i,
  );
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
  const espn = s.match(/^(\d+)'(?:\+(\d+)')?$/);
  if (espn) return (Number(espn[1]) + Number(espn[2] || 0)) * 60;
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
    const plusMatch = name.match(/^(\d+)\+/);
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
  const bounds = parseWindowBounds(window);
  return {
    minutes,
    window,
    startSeconds: bounds?.startSeconds ?? null,
    endSeconds: bounds?.endSeconds ?? null,
    market: name,
    status: market.marketStatus ?? null,
    ...extractWindowSelections(market),
  };
}

function isCornerWindowMarket(name, minutes) {
  const n = String(name ?? '');
  const dedicated = new RegExp(
    `(?:match\\s+)?corners?\\s+in\\s+${minutes}\\s+minutes?|next\\s+${minutes}\\s+(?:min(?:ute)?s?)\\s+corners?`,
    'i',
  );
  const outcomes = new RegExp(`match\\s+outcomes\\s+in\\s+${minutes}\\s+minutes?`, 'i');
  return dedicated.test(n) || outcomes.test(n);
}

function pickWindowMarket(markets, minutes, clockPlayed) {
  if (!markets) return null;
  const matches = [];

  for (const market of Object.values(markets)) {
    const name = String(market.marketName ?? '');
    if (!isCornerWindowMarket(name, minutes)) continue;
    if (String(market.marketStatus ?? '').toUpperCase() === 'CLOSED') continue;
    const summarized = summarizeWindowMarket(market, minutes);
    if (!summarized.plus.length && !summarized.overUnder.length && !summarized.other.length) {
      continue;
    }
    const windowMatch = name.match(/\(([^)]+)\)/);
    const bounds = parseWindowBounds(windowMatch?.[1]);
    matches.push({ summarized, bounds, start: bounds?.startSeconds ?? Number.POSITIVE_INFINITY });
  }

  if (!matches.length) return null;

  const clockSeconds = clockToSeconds(clockPlayed);
  if (clockSeconds != null) {
    const containing = matches.filter(
      (m) => m.bounds && clockSeconds >= m.bounds.startSeconds && clockSeconds <= m.bounds.endSeconds,
    );
    if (containing.length) {
      containing.sort((a, b) => b.start - a.start);
      return containing[0].summarized;
    }
    const upcoming = matches.filter((m) => m.bounds && m.bounds.startSeconds >= clockSeconds);
    if (upcoming.length) {
      upcoming.sort((a, b) => a.start - b.start);
      return upcoming[0].summarized;
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return matches[0].summarized;
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

function formatClockLabel(seconds) {
  if (seconds == null) return null;
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (s === 0) return `${m}'`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function compactProviderError(err) {
  const s = String(err ?? '');
  if (/Access Denied/i.test(s) || /\b403\b/.test(s)) return '403 from ESPN';
  if (/401/.test(s)) return '401 unauthorized';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function parseEspnClock(display) {
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

function playType(play) {
  return String(play?.type?.type ?? play?.type?.text ?? '').toLowerCase();
}

function isGoalPlay(play) {
  if (play?.scoringPlay) return true;
  const type = playType(play);
  return type === 'own-goal' || type === 'goal' || type.startsWith('goal---');
}

function playText(play) {
  return String(play?.text ?? play?.shortText ?? '');
}

function playPeriod(play) {
  const n = Number(play?.period?.number);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function playClockKey(play) {
  return String(play?.clock?.displayValue ?? '').trim();
}

function isoMs(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
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

function boxscoreCorners(event) {
  const competition = event?.competitions?.[0] ?? {};
  let total = 0;
  let found = false;
  for (const team of competition.competitors ?? []) {
    for (const s of team.statistics ?? []) {
      const name = String(s?.name ?? s?.abbreviation ?? '').toLowerCase();
      if (name === 'woncorners' || name === 'corners' || name === 'ck') {
        const n = Number(s.displayValue ?? s.value);
        if (Number.isFinite(n)) {
          total += n;
          found = true;
        }
      }
    }
  }
  return found ? total : null;
}

function countCornerPlays(plays, period = null) {
  if (!plays?.length) return null;
  let n = 0;
  for (const play of plays) {
    if (period != null && playPeriod(play) !== period) continue;
    const type = playType(play);
    const text = playText(play);
    if (type === 'corner-awarded' || type === 'corner' || /^corner[,.]/i.test(text)) {
      n += 1;
    }
  }
  return n;
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

function playsUrl(gameId, page) {
  const id = encodeURIComponent(String(gameId));
  const pageQ = page > 1 ? `&page=${page}` : '';
  return `${ESPN_PLAYS_URL}/${id}/competitions/${id}/plays?limit=${ESPN_PLAYS_LIMIT}${pageQ}`;
}

async function fetchEspnPlays(gameId) {
  const first = await espnGetJson(playsUrl(gameId, 1));
  const pageCount = Math.min(
    Number(first?.pageCount) || 1,
    ESPN_PLAYS_MAX_PAGES,
  );
  const pages = [first];
  if (pageCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, i) => espnGetJson(playsUrl(gameId, i + 2))),
    );
    pages.push(...rest);
  }
  const items = [];
  const seen = new Set();
  for (const page of pages) {
    for (const play of page?.items ?? []) {
      const id = play?.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      items.push(play);
    }
  }
  return items;
}

function currentPeriodFromStatus(status, clock) {
  const period = Number(status?.period);
  if (Number.isFinite(period) && period > 0) return period;
  const name = String(status?.type?.name ?? status?.type?.description ?? '');
  if (/HALFTIME/i.test(name)) return 1;
  if (clock?.elapsed != null) return clock.elapsed <= 45 ? 1 : 2;
  return 2;
}

function isLiveEspnStatus(status) {
  const state = String(status?.type?.state ?? '').toLowerCase();
  const name = String(status?.type?.name ?? '');
  return state === 'in' || /HALFTIME/i.test(name);
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

function delaySecondsFromPlays(plays, period) {
  const starts = [];
  const ends = [];
  for (const play of plays) {
    if (playPeriod(play) !== period) continue;
    const type = playType(play);
    const text = playText(play);
    if (!text) continue;
    if (type === 'start-delay') starts.push(play);
    if (type === 'end-delay') ends.push(play);
  }

  let total = 0;
  const usedEnds = new Set();
  for (const start of starts) {
    const startMs = isoMs(start.wallclock);
    let matched = null;
    for (const end of ends) {
      if (usedEnds.has(end.id)) continue;
      const endMs = isoMs(end.wallclock);
      if (startMs != null && endMs != null && endMs < startMs) continue;
      matched = end;
      break;
    }
    if (matched) {
      usedEnds.add(matched.id);
      const endMs = isoMs(matched.wallclock);
      if (startMs != null && endMs != null) {
        total += Math.max(0, Math.min(10 * 60, (endMs - startMs) / 1000));
        continue;
      }
    }
    total += STOPPAGE_SEC.delayFallback;
  }
  return { seconds: total, count: starts.length };
}

function estimateStoppageFromPlays(plays, period) {
  const inPeriod = (plays ?? []).filter((p) => playPeriod(p) === period);
  let goals = 0;
  let yellows = 0;
  let reds = 0;
  let penalties = 0;
  let varReviews = 0;
  const subStops = new Set();

  for (const play of inPeriod) {
    const type = playType(play);
    const text = playText(play);
    if (isGoalPlay(play)) goals += 1;
    if (play.yellowCard || type === 'yellow-card') yellows += 1;
    if (play.redCard || type === 'red-card' || type === 'second-yellow') reds += 1;
    if (play.penaltyKick || type === 'penalty' || type === 'penalty-awarded') penalties += 1;
    if (play.substitution || type === 'substitution') {
      subStops.add(playClockKey(play) || String(play.id));
    }
    if (/\bVAR\b|video review|var review/i.test(text) || type.includes('var')) {
      varReviews += 1;
    }
  }

  const delays = delaySecondsFromPlays(inPeriod, period);
  const seconds =
    (period === 1 ? STOPPAGE_SEC.baseFirst : STOPPAGE_SEC.baseSecond)
    + goals * STOPPAGE_SEC.goal
    + yellows * STOPPAGE_SEC.yellow
    + reds * STOPPAGE_SEC.red
    + subStops.size * STOPPAGE_SEC.subStop
    + varReviews * STOPPAGE_SEC.varReview
    + penalties * STOPPAGE_SEC.penalty
    + delays.seconds;

  return {
    seconds,
    breakdown: {
      goals,
      substitutions: subStops.size,
      yellows,
      reds,
      penalties,
      varReviews,
      delays: delays.count,
      delaySeconds: Math.round(delays.seconds),
    },
  };
}

function latestAddedClockSeconds(plays, period) {
  let best = null;
  for (const play of plays ?? []) {
    if (period != null && playPeriod(play) !== period) continue;
    const value = Number(play?.addedClock?.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (best == null || value > best) best = value;
  }
  return best;
}

function announcedFromPlays(plays, period) {
  let latest = null;
  for (const play of plays ?? []) {
    if (period != null && playPeriod(play) !== period) continue;
    const text = playText(play);
    const m = text.match(/(?:fourth official has )?announced\s+(\d+)\s+minutes?\s+of added time/i);
    if (!m) continue;
    latest = Number(m[1]);
  }
  return Number.isFinite(latest) ? latest : null;
}

function breakdownLabel(breakdown) {
  if (!breakdown) return null;
  const bits = [];
  if (breakdown.goals) bits.push(`${breakdown.goals} goal${breakdown.goals === 1 ? '' : 's'}`);
  if (breakdown.substitutions) bits.push(`${breakdown.substitutions} sub stop${breakdown.substitutions === 1 ? '' : 's'}`);
  if (breakdown.yellows) bits.push(`${breakdown.yellows} yellow${breakdown.yellows === 1 ? '' : 's'}`);
  if (breakdown.reds) bits.push(`${breakdown.reds} red${breakdown.reds === 1 ? '' : 's'}`);
  if (breakdown.varReviews) bits.push(`${breakdown.varReviews} VAR`);
  if (breakdown.delays) bits.push(`${breakdown.delays} delay${breakdown.delays === 1 ? '' : 's'}`);
  return bits.length ? bits.join(' · ') : 'no delay events yet';
}

function extractEspnStoppage(event, plays) {
  const competition = event?.competitions?.[0] ?? {};
  const status = competition.status ?? {};
  const teams = competitorsFromEspnEvent(event);
  const clock = parseEspnClock(status.displayClock);
  const period = currentPeriodFromStatus(status, clock);
  const finished = isFinishedEspnStatus(status);
  const estimate = plays?.length ? estimateStoppageFromPlays(plays, period) : null;
  const announcedMinutes = announcedFromPlays(plays, period);
  const addedSeconds = latestAddedClockSeconds(plays, period);
  const playedSeconds =
    addedSeconds
    ?? (clock.inStoppage ? clock.plus * 60 : finished && clock.plus ? clock.plus * 60 : null);

  let expectedSeconds = estimate?.seconds ?? null;
  if (announcedMinutes != null) {
    expectedSeconds = Math.max(expectedSeconds ?? 0, announcedMinutes * 60);
  }
  if (playedSeconds != null && expectedSeconds != null) {
    expectedSeconds = Math.max(expectedSeconds, playedSeconds);
  }
  if (finished && playedSeconds != null && expectedSeconds == null) {
    expectedSeconds = playedSeconds;
  }

  const remainingSeconds =
    expectedSeconds != null
      ? Math.max(0, expectedSeconds - (playedSeconds ?? 0))
      : null;

  const matchStatus = status.type?.description ?? status.type?.detail ?? status.type?.name ?? null;
  const boxCorners = boxscoreCorners(event);
  const playCorners = countCornerPlays(plays);
  const playCornersH1 = countCornerPlays(plays, 1);
  const cornersSoFar = boxCorners ?? playCorners;
  const firstHalfCornersSoFar = period === 1
    ? (playCornersH1 ?? cornersSoFar)
    : playCornersH1;
  const halftime = isHalftimeEspnStatus(status) && !finished;

  if (halftime) {
    const shSeconds = 4.8 * 60;
    return {
      matchStatus: matchStatus || 'Halftime',
      status: status.type?.state ?? 'in',
      clock: 'HT',
      elapsed: 45,
      plus: 0,
      inStoppage: false,
      announced: null,
      played: "0'",
      expectedMinutes: 4.8,
      remainingLabel: formatClockLabel(shSeconds),
      expectedLabel: formatClockLabel(Math.round(shSeconds / 30) * 30),
      playedLabel: "0'",
      homeScore: teams.homeScore,
      awayScore: teams.awayScore,
      source: 'espn',
      estimated: true,
      period: 1,
      halfTime: true,
      breakdown: null,
      breakdownLabel: 'First-half extra is done · second-half stoppage resets to typical 4.8′',
      cornersSoFar,
      firstHalfCornersSoFar,
    };
  }

  return {
    matchStatus,
    status: status.type?.state ?? null,
    clock: clock.display,
    elapsed: clock.elapsed,
    plus: clock.plus,
    inStoppage: clock.inStoppage,
    announced: announcedMinutes != null ? `${announcedMinutes}:00` : null,
    played: playedSeconds != null ? formatClockLabel(playedSeconds) : null,
    expectedMinutes: expectedSeconds != null ? expectedSeconds / 60 : null,
    remainingLabel: finished
      ? (playedSeconds != null ? "0'" : null)
      : formatClockLabel(remainingSeconds),
    expectedLabel: expectedSeconds != null
      ? formatClockLabel(Math.round(expectedSeconds / 30) * 30)
      : null,
    playedLabel: playedSeconds != null ? formatClockLabel(playedSeconds) : null,
    homeScore: teams.homeScore,
    awayScore: teams.awayScore,
    source: 'espn',
    estimated: Boolean(estimate) && announcedMinutes == null,
    period,
    breakdown: estimate?.breakdown ?? null,
    breakdownLabel: breakdownLabel(estimate?.breakdown),
    cornersSoFar,
    firstHalfCornersSoFar,
  };
}

function summarizeEspnEvent(event, plays) {
  const teams = competitorsFromEspnEvent(event);
  return {
    id: event?.id ?? event?.competitions?.[0]?.id ?? null,
    teams: { home: teams.home, away: teams.away },
    startTime: event?.date ?? event?.competitions?.[0]?.date ?? null,
    stoppage: extractEspnStoppage(event, plays),
  };
}

async function fetchEspnStoppage(openDates) {
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

    const events = [...eventsById.values()];
    const needPlays = events.filter((event) => {
      const status = event?.competitions?.[0]?.status;
      return isLiveEspnStatus(status);
    });

    const playsById = new Map();
    const playErrors = [];
    await Promise.all(
      needPlays.map(async (event) => {
        try {
          playsById.set(String(event.id), await fetchEspnPlays(event.id));
        } catch (err) {
          playErrors.push(`${event.id}: ${err.message}`);
          playsById.set(String(event.id), []);
        }
      }),
    );

    const matches = events.map((event) => summarizeEspnEvent(event, playsById.get(String(event.id)) ?? []));
    return {
      ok: playErrors.length === 0,
      error: playErrors.length ? compactProviderError(playErrors[0]) : null,
      matches,
      livePremierLeague: needPlays.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'ESPN fetch failed',
      matches: [],
    };
  }
}

function findLiveMatch(game, matchSets) {
  const home = game.teams?.home;
  const away = game.teams?.away;
  if (!home || !away) return null;
  for (const { source, matches } of matchSets) {
    const hit = (matches ?? []).find(
      (m) => namesMatch(home, m.teams.home) && namesMatch(away, m.teams.away),
    );
    if (hit) return { ...hit, source };
  }
  return null;
}

function attachStoppage(game, matchSets) {
  if (game.error || !game._markets) return { ...game, stoppage: null };
  const hit = findLiveMatch(game, matchSets);
  if (!hit) return { ...game, stoppage: null };

  const stoppage = hit.stoppage;
  const useful =
    stoppage
    && (
      stoppage.status === 'in'
      || stoppage.status === 'post'
      || stoppage.expectedLabel
      || stoppage.played
    );
  if (!useful) return { ...game, stoppage: null };

  const clockPlayed = stoppage.clock;
  return {
    ...game,
    stoppage: { ...stoppage, source: hit.source ?? 'espn' },
    espnId: hit.id,
    cornersSoFar: stoppage.cornersSoFar ?? game.cornersSoFar ?? null,
    firstHalfCornersSoFar: stoppage.firstHalfCornersSoFar ?? game.firstHalfCornersSoFar ?? null,
    next5: pickWindowMarket(game._markets, 5, clockPlayed) ?? game.next5,
    next10: pickWindowMarket(game._markets, 10, clockPlayed) ?? game.next10,
    score: stoppage.homeScore != null
      ? { home: stoppage.homeScore, away: stoppage.awayScore ?? 0 }
      : game.score,
    scoreDisplay: stoppage.homeScore != null
      ? `${stoppage.homeScore}-${stoppage.awayScore ?? 0}`
      : game.scoreDisplay,
  };
}

async function fetchPlCornerBook() {
  const sportPage = await fdFetch(`/content-managed-page?${FD_QUERY}&page=SPORT&eventTypeId=1`);
  const events = plMatchEvents(sportPage);

  const [fdGames, espn] = await Promise.all([
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
            firstHalfTotal: extractFirstHalfCorners(bundle.markets),
            next5: pickWindowMarket(bundle.markets, 5, null),
            next10: pickWindowMarket(bundle.markets, 10, null),
            _markets: bundle.markets,
          };
        } catch (err) {
          return { ...ev, error: err.message, stoppage: null };
        }
      }),
    ),
    fetchEspnStoppage(events.map((ev) => ev.openDate)),
  ]);

  const matchSets = [{ source: 'espn', matches: espn.matches }];

  const games = fdGames
    .map((game) => {
      const merged = attachStoppage(game, matchSets);
      const { _markets, ...rest } = merged;
      return {
        ...rest,
        cornersSoFar: Number.isFinite(rest.cornersSoFar) ? rest.cornersSoFar : 0,
        firstHalfCornersSoFar: Number.isFinite(rest.firstHalfCornersSoFar)
          ? rest.firstHalfCornersSoFar
          : (Number.isFinite(rest.cornersSoFar) ? rest.cornersSoFar : 0),
      };
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
    espn: {
      ok: espn.ok,
      error: espn.error ? compactProviderError(espn.error) : null,
      livePremierLeague: espn.livePremierLeague ?? 0,
      matched: games.filter((g) => g.stoppage).length,
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
