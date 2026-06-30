/**
 * DraftKings World Cup First Goal Method scraper.
 * Proxies DraftKings' undocumented sportsbook API — structure can change without notice.
 *
 * Local dev: run `npm run dk:login` once to save session cookies to .env.local (gitignored).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DK_BASE = 'https://sportsbook.draftkings.com/sites/US-SB/api';
const DK_COOKIE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.dk-cookies.json');
const WC_EVENT_GROUP_ID = '209533';

const DK_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://sportsbook.draftkings.com/leagues/soccer/fifa-world-cup',
  Origin: 'https://sportsbook.draftkings.com',
};

const GOAL_METHOD_PATTERNS = [
  /^first goal method$/i,
  /^next goal method$/i,
  /^1st goal method$/i,
  /^next goal method - /i,
  /^first goal method - /i,
];

const CORRECT_SCORE_MARKET = /^correct score$/i;
const TOTAL_GOALS_MARKET = /^total goals$/i;
const NTH_GOAL_MARKET = /^(first|second|third|fourth|fifth|sixth|seventh|eighth) team to score$/i;
const NTH_GOAL_ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const GOAL_TYPE_OUTCOMES = {
  sop: ['Shot Open Play', 'Open Play', 'Shot - Open Play'],
  header: ['Header'],
  pk: ['Penalty', 'Penalty Kick'],
  fk: ['Free Kick'],
  og: ['Own Goal'],
};

const NO_GOAL_OUTCOMES = ['No Goal', 'No Goals', 'Neither'];

function parseAmerican(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/^\+/, ''));
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

function marketLabelMatches(label, patterns) {
  const target = normalizeLabel(label);
  return patterns.some((p) => (p instanceof RegExp ? p.test(target) : target === normalizeLabel(p)));
}

function flattenOffers(payload) {
  const rows = [];
  const categories = payload?.eventCategories ?? payload?.eventGroup?.offerCategories ?? [];

  for (const category of categories) {
    const categoryName = category?.name ?? null;
    const componentized = category?.componentizedOffers ?? category?.offerSubcategoryDescriptors ?? [];

    for (const comp of componentized) {
      const subcategoryName = comp?.subcategoryName ?? comp?.name ?? null;
      const offerRows = comp?.offers ?? comp?.offerSubcategory?.offers ?? [];

      for (const offerRow of offerRows) {
        const offers = Array.isArray(offerRow) ? offerRow : [offerRow];
        for (const offer of offers) {
          if (!offer) continue;
          rows.push({
            offer,
            categoryName,
            subcategoryName,
            marketLabel: offer.label ?? subcategoryName ?? categoryName,
          });
        }
      }
    }
  }

  return rows;
}

function outcomeQuote(outcome) {
  if (!outcome) return null;
  return {
    american: parseAmerican(outcome.oddsAmerican),
    status: outcome.status ?? outcome.hidden ?? null,
    runnerName: outcome.label ?? outcome.participant ?? null,
  };
}

function findOutcomeQuote(outcomes, names) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  for (const name of names) {
    const match = list.find((o) => labelMatches(o?.label ?? o?.participant, [name]));
    if (match) return outcomeQuote(match);
  }
  return null;
}

function findMarketRows(rows, matcher) {
  return rows.filter(({ marketLabel, subcategoryName, categoryName }) => {
    const candidates = [marketLabel, subcategoryName, categoryName].filter(Boolean);
    return candidates.some((label) => matcher(label));
  });
}

function findGoalMethodMarket(rows) {
  const matches = findMarketRows(rows, (label) => marketLabelMatches(label, GOAL_METHOD_PATTERNS));
  return matches[0]?.offer ?? null;
}

function findMarketByPattern(rows, pattern) {
  const matches = findMarketRows(rows, (label) => marketLabelMatches(label, [pattern]));
  return matches[0]?.offer ?? null;
}

function parseTeams(name) {
  const raw = String(name ?? '');
  const split = raw.split(/\s+@\s+|\s+v\s+/i);
  if (split.length === 2) {
    return { away: split[0].trim() || null, home: split[1].trim() || null };
  }
  return { home: null, away: null };
}

function scoreDisplay(score) {
  return `${score.home}-${score.away}`;
}

function parseEventScore(event) {
  const live = event?.eventStatus?.liveGameState ?? event?.liveGameState ?? null;
  const home = Number(live?.homeScore ?? live?.homeTeamScore ?? event?.eventStatus?.homeTeamScore);
  const away = Number(live?.awayScore ?? live?.awayTeamScore ?? event?.eventStatus?.awayTeamScore);
  if (Number.isFinite(home) && Number.isFinite(away)) {
    return { home, away };
  }
  return { home: 0, away: 0 };
}

function nthGoalMarketName(goalNumber) {
  const ordinal = NTH_GOAL_ORDINALS[goalNumber - 1] ?? `${goalNumber}th`;
  return `${ordinal} Team to Score`;
}

function findNthGoalMarket(rows, goalNumber) {
  const target = normalizeLabel(nthGoalMarketName(goalNumber));
  const matches = findMarketRows(rows, (label) => normalizeLabel(label) === target);
  return matches[0]?.offer ?? null;
}

function extractGoalTypes(rows) {
  const market = findGoalMethodMarket(rows);
  if (!market?.outcomes) return null;

  const out = {};
  for (const [key, names] of Object.entries(GOAL_TYPE_OUTCOMES)) {
    const quote = findOutcomeQuote(market.outcomes, names);
    if (quote) out[key] = quote;
  }
  return Object.keys(out).length ? out : null;
}

function extractNoGoalMarkets(rows, score, teams, inPlay) {
  const totalGoals = score.home + score.away;
  const nextGoalNumber = totalGoals + 1;
  const underLine = totalGoals + 0.5;
  const scoreKey = scoreDisplay(score);

  const goalMethod = findGoalMethodMarket(rows);
  const correctScore = findMarketByPattern(rows, CORRECT_SCORE_MARKET);
  const totalsMarket = findMarketByPattern(rows, TOTAL_GOALS_MARKET);
  const nthGoalMarket = findNthGoalMarket(rows, inPlay ? Math.max(1, nextGoalNumber) : nextGoalNumber);

  const underOutcome = (totalsMarket?.outcomes ?? []).find((o) => {
    const label = String(o?.label ?? '').toLowerCase();
    return label.includes('under') && label.includes(String(underLine));
  });

  const nthRunnerNames = nextGoalNumber === 1
    ? ['No Goals', 'No Goal', 'Neither']
    : ['Neither', 'No Goals', 'No Goal'];

  return {
    nextGoalMethod: {
      market: goalMethod?.label ?? 'Goal Method',
      selection: 'No Goal',
      ...findOutcomeQuote(goalMethod?.outcomes, NO_GOAL_OUTCOMES),
    },
    correctScore: {
      market: 'Correct Score',
      selection: scoreKey,
      scoreUsed: scoreKey,
      ...findOutcomeQuote(correctScore?.outcomes, [scoreKey, `${score.home}:${score.away}`]),
    },
    totalGoalsUnder: {
      market: totalsMarket?.label ?? `Total Goals`,
      selection: `Under ${underLine}`,
      line: underLine,
      totalGoals,
      ...outcomeQuote(underOutcome),
    },
    nthGoalNeither: {
      market: nthGoalMarket?.label ?? nthGoalMarketName(nextGoalNumber),
      selection: nthRunnerNames[0],
      goalNumber: nextGoalNumber,
      ...findOutcomeQuote(nthGoalMarket?.outcomes, nthRunnerNames),
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

function dkRequestHeaders() {
  const headers = { ...DK_HEADERS };
  const cookie = loadDkCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function dkFetch(path) {
  const res = await fetch(`${DK_BASE}${path}`, { headers: dkRequestHeaders() });
  if (!res.ok) {
    const snippet = await res.text().catch(() => '');
    const blocked = res.status === 403 || /access denied/i.test(snippet);
    const hasCookie = Boolean(loadDkCookieHeader());
    let hint = '';
    if (blocked && !hasCookie) {
      hint = ' (run: npm run dk:login — saves cookies to .env.local)';
    } else if (blocked) {
      hint = ' (cookie present but still blocked — re-run dk:login or check geo)';
    }
    throw new Error(`DraftKings ${path} returned ${res.status}${hint}`);
  }
  return res.json();
}

function isMatchEvent(event) {
  const name = String(event?.name ?? '');
  return /@| v /i.test(name);
}

function eventIsInPlay(event) {
  const state = String(event?.eventStatus?.state ?? event?.status ?? '').toUpperCase();
  return state === 'STARTED' || state === 'LIVE' || state === 'IN_PROGRESS';
}

function listEvents(payload) {
  const events = payload?.eventGroup?.events ?? [];
  return events
    .filter(isMatchEvent)
    .map((ev) => ({
      eventId: String(ev.eventId),
      name: ev.name,
      openDate: ev.startDate ?? null,
      inPlay: eventIsInPlay(ev),
      teams: {
        home: ev.teamName2 ?? parseTeams(ev.name).home,
        away: ev.teamName1 ?? parseTeams(ev.name).away,
      },
    }));
}

async function fetchEventBundle(eventMeta) {
  const payload = await dkFetch(`/v1/event/${eventMeta.eventId}?format=json&includePromotions=true`);
  const event = payload?.event ?? payload ?? {};
  const rows = flattenOffers(payload);
  const teams = {
    home: event.teamName2 ?? eventMeta.teams?.home ?? parseTeams(event.name ?? eventMeta.name).home,
    away: event.teamName1 ?? eventMeta.teams?.away ?? parseTeams(event.name ?? eventMeta.name).away,
  };
  const inPlay = eventIsInPlay(event) || eventMeta.inPlay;
  const score = parseEventScore(event);

  return {
    ...eventMeta,
    name: event.name ?? eventMeta.name,
    openDate: event.startDate ?? eventMeta.openDate,
    inPlay,
    score,
    scoreDisplay: scoreDisplay(score),
    teams,
    goalTypes: extractGoalTypes(rows),
    noGoalMarkets: extractNoGoalMarkets(rows, score, teams, inPlay),
  };
}

export async function fetchWorldCupGoalMethodOdds() {
  const groupPayload = await dkFetch(`/v5/eventgroups/${WC_EVENT_GROUP_ID}?format=json`);
  const events = listEvents(groupPayload);

  const results = await Promise.all(
    events.map(async (ev) => {
      try {
        return await fetchEventBundle(ev);
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
    const data = await fetchWorldCupGoalMethodOdds();
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[draftkings-goal-method]', err);
    return res.status(502).json({ error: err.message || 'DraftKings fetch failed' });
  }
}
