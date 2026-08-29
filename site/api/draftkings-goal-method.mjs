/**
 * DraftKings Premier League SOP + no-goal scraper (Nash / controldata API).
 * Discovers events from the PL league feed (40253), then pulls goal-method,
 * correct score, totals, first/next goal, and goalscorer markets.
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
const PL_LEAGUE_ID = '40253';
const PL_LEAGUE_SEO = 'england---premier-league';
const GOAL_METHOD_SUBCATEGORY_ID = '6541';
const FIRST_GOAL_SUBCATEGORY_ID = '19742';
const TOTAL_GOALS_SUBCATEGORY_ID = '13171';
const CORRECT_SCORE_SUBCATEGORY_ID = '5844';
const GOALSCORER_PRE_SUBCATEGORY_ID = '16604';
const GOALSCORER_LIVE_SUBCATEGORY_ID = '20020';
const NEXT_GOAL_LIVE_SUBCATEGORY_ID = '6007';

const DK_PE_LOC = (() => {
  const raw = (process.env.DK_PE_LOC || 'US-NY').trim().toUpperCase();
  return raw.startsWith('US-') ? raw : `US-${raw}`;
})();
const DK_SITE = process.env.DK_SITE || `${DK_PE_LOC}-SB`;
const DK_NASH_BASE = `https://sportsbook-nash.draftkings.com/sites/${DK_SITE}/api`;
const DK_FETCH_CONCURRENCY = Number(process.env.DK_FETCH_CONCURRENCY || 4);
const DK_FETCH_RETRIES = Number(process.env.DK_FETCH_RETRIES || 1);
const DK_FETCH_RETRY_MS = Number(process.env.DK_FETCH_RETRY_MS || 400);
/** Whole handler budget — return partial/empty rather than hang SOP. */
const DK_HANDLER_TIMEOUT_MS = Number(process.env.DK_HANDLER_TIMEOUT_MS || 20000);

const GOAL_TYPE_SELECTIONS = {
  sop: ['Shot', 'Shot Open Play', 'Open Play', 'Shot - Open Play'],
  header: ['Header'],
  pk: ['Penalty', 'Penalty Kick'],
  fk: ['Free Kick'],
  og: ['Own Goal'],
};

const NO_GOAL_SELECTIONS = ['No Goal', 'No Goals', 'Neither'];

export function parseAmerican(raw) {
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

const TEAM_SLUG_ALIASES = {
  hull: 'hull',
  'hull-city': 'hull',
  'nottm-forest': 'nottingham-forest',
  'nottingham-forest': 'nottingham-forest',
  'man-utd': 'man-utd',
  'manchester-united': 'man-utd',
  'man-city': 'man-city',
  'manchester-city': 'man-city',
  tottenham: 'tottenham',
  'tottenham-hotspur': 'tottenham',
  newcastle: 'newcastle',
  'newcastle-united': 'newcastle',
  brighton: 'brighton',
  'brighton-hove-albion': 'brighton',
  'brighton-and-hove-albion': 'brighton',
  bournemouth: 'bournemouth',
  'afc-bournemouth': 'bournemouth',
  ipswich: 'ipswich',
  'ipswich-town': 'ipswich',
  leeds: 'leeds',
  'leeds-united': 'leeds',
  wolves: 'wolves',
  wolverhampton: 'wolves',
  'wolverhampton-wanderers': 'wolves',
};

export function fdNameToSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+v\s+/i, '-vs-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeTeamSlug(team) {
  const slug = fdNameToSlug(team);
  return TEAM_SLUG_ALIASES[slug] ?? slug;
}

export function fixtureTeamKey(name) {
  const parts = String(name ?? '')
    .split(/\s+v\s+/i)
    .map((team) => normalizeTeamSlug(team))
    .filter(Boolean)
    .sort();
  return parts.length === 2 ? parts.join('|') : null;
}

function slugTeamKey(slug) {
  const normalized = String(slug ?? '').replace(/-v-/g, '-vs-');
  const parts = normalized
    .split('-vs-')
    .map((team) => normalizeTeamSlug(team))
    .filter(Boolean)
    .sort();
  return parts.length === 2 ? parts.join('|') : null;
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

export async function mapPool(items, concurrency, fn) {
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

function nashHeaders({ page = 'event', referer = `https://sportsbook.draftkings.com/leagues/soccer/${PL_LEAGUE_SEO}` } = {}) {
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

export function selectionQuote(selection) {
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
  const matchesGoalNumber = (name) =>
    new RegExp(`${goalNumber}(?:${ordinalSuffix(goalNumber)})?\\s+goal`, 'i').test(name ?? '');
  // Only treat "1st / First / Next Goal" as a fallback before anyone has scored.
  const market =
    (markets ?? []).find((m) => matchesGoalNumber(m.name))
    ?? (goalNumber === 1
      ? (markets ?? []).find((m) => /(?:next|first|1st)\s+goal/i.test(m.name ?? ''))
      : null)
    ?? (goalNumber === 1 ? markets?.[0] : null)
    ?? null;
  if (!market) return null;

  const marketSelections = marketSelectionsFor(selections, market);
  const quote = findNoNthGoalQuote(marketSelections, goalNumber);
  if (!quote || quote.american == null) return null;

  return {
    market: market.name ?? `Next Goal (${goalNumber})`,
    selection: quote?.runnerName ?? `No ${goalNumber}${ordinalSuffix(goalNumber)} Goal`,
    ...quote,
  };
}

export function marketSelectionsFor(selections, market) {
  if (!market) return [];
  const id = String(market.id);
  return (selections ?? []).filter((s) => String(s.marketId) === id);
}

function extractCorrectScoreQuote(markets, selections, score) {
  const key = `${score.home}-${score.away}`;
  const market =
    (markets ?? []).find((m) => /correct score/i.test(m.name ?? ''))
    ?? markets?.[0]
    ?? null;
  if (!market) return null;
  const marketSelections = marketSelectionsFor(selections, market);
  const quote = findSelectionQuote(marketSelections, [
    key,
    `${score.home} - ${score.away}`,
    `${score.home}–${score.away}`,
  ]);
  if (!quote || quote.american == null) return null;
  return {
    market: market.name ?? 'Correct Score',
    selection: key,
    scoreUsed: key,
    ...quote,
  };
}

function extractNextGoalscorerQuote(markets, selections, goalNumber) {
  const ranked = [...(markets ?? [])].sort((a, b) => {
    const scoreName = (name) => {
      const n = String(name ?? '');
      if (goalNumber === 1 && /^(1st|first)\s+goalscorer$/i.test(n)) return 0;
      if (new RegExp(`${goalNumber}(?:st|nd|rd|th)?\\s+goalscorer`, 'i').test(n)) return 1;
      if (/^(1st|first)\s+goalscorer$/i.test(n)) return 2;
      if (/goalscorer/i.test(n)) return 3;
      return 4;
    };
    return scoreName(a.name) - scoreName(b.name);
  });
  for (const market of ranked) {
    const name = String(market.name ?? '');
    if (/anytime|2 or more|to score 2/i.test(name)) continue;
    if (goalNumber === 1 && /^(2nd|3rd|4th|second|third)/i.test(name)) continue;
    if (/\b(home|away)\b/i.test(name)) continue;
    const marketSelections = marketSelectionsFor(selections, market);
    const quote = findSelectionQuote(marketSelections, ['No Goalscorer', 'No Goal', 'No Goals']);
    if (quote?.american != null) {
      return {
        market: market.name ?? 'Next Goalscorer',
        selection: quote.runnerName ?? 'No Goalscorer',
        goalNumber,
        ...quote,
      };
    }
  }
  return null;
}

function extractTotalGoalsUnderLive(markets, selections, score) {
  const totalGoals = score.home + score.away;
  const underLine = totalGoals + 0.5;
  const lineStr = String(underLine);

  for (const market of markets ?? []) {
    const marketSelections = marketSelectionsFor(selections, market);
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

export async function fetchSubcategoryQuiet(eventId, subcategoryId, seoSlug) {
  try {
    return await fetchSubcategoryMarkets(eventId, subcategoryId, seoSlug);
  } catch (_) {
    return { markets: [], selections: [] };
  }
}

async function fetchFirstGoalMethodBundle(eventId, eventMeta = {}) {
  const seoSlug = eventMeta.seoSlug ?? 'premier-league';
  const teams = eventMeta.teams ?? { home: null, away: null };
  const score = eventMeta.score ?? { home: 0, away: 0 };
  const inPlay = Boolean(eventMeta.inPlay);
  const goalNumber = (score.home ?? 0) + (score.away ?? 0) + 1;

  const subcategoryIds = inPlay
    ? [
      NEXT_GOAL_LIVE_SUBCATEGORY_ID,
      FIRST_GOAL_SUBCATEGORY_ID,
      TOTAL_GOALS_SUBCATEGORY_ID,
      CORRECT_SCORE_SUBCATEGORY_ID,
      GOALSCORER_LIVE_SUBCATEGORY_ID,
      GOAL_METHOD_SUBCATEGORY_ID,
    ]
    : [
      GOAL_METHOD_SUBCATEGORY_ID,
      FIRST_GOAL_SUBCATEGORY_ID,
      TOTAL_GOALS_SUBCATEGORY_ID,
      CORRECT_SCORE_SUBCATEGORY_ID,
      GOALSCORER_PRE_SUBCATEGORY_ID,
    ];

  const bundles = await Promise.all(
    subcategoryIds.map((id) => fetchSubcategoryQuiet(eventId, id, seoSlug)),
  );
  const byId = Object.fromEntries(subcategoryIds.map((id, i) => [id, bundles[i]]));

  const method = byId[GOAL_METHOD_SUBCATEGORY_ID] ?? { markets: [], selections: [] };
  const methodMarket =
    (method.markets ?? []).find((m) => /goal method/i.test(m.name ?? ''))
    ?? method.markets?.[0]
    ?? null;
  const methodSelections = marketSelectionsFor(method.selections ?? [], methodMarket);
  const base = extractNoGoalFromGoalMethod(methodMarket, methodSelections, score, teams, inPlay);

  const firstGoal = byId[FIRST_GOAL_SUBCATEGORY_ID];
  const liveNext = byId[NEXT_GOAL_LIVE_SUBCATEGORY_ID];
  const totals = byId[TOTAL_GOALS_SUBCATEGORY_ID];
  const scores = byId[CORRECT_SCORE_SUBCATEGORY_ID];
  const scorers = byId[inPlay ? GOALSCORER_LIVE_SUBCATEGORY_ID : GOALSCORER_PRE_SUBCATEGORY_ID];

  const nextGoalLive = extractNoGoalFromNextGoalLive(
    liveNext?.markets ?? [],
    liveNext?.selections ?? [],
    score,
  );
  const firstGoalNeither = extractNoGoalFromNextGoalLive(
    firstGoal?.markets ?? [],
    firstGoal?.selections ?? [],
    score,
  );
  const totalGoalsUnder = extractTotalGoalsUnderLive(
    totals?.markets ?? [],
    totals?.selections ?? [],
    score,
  );
  const correctScore = extractCorrectScoreQuote(
    scores?.markets ?? [],
    scores?.selections ?? [],
    score,
  );
  const nextGoalscorer = extractNextGoalscorerQuote(
    scorers?.markets ?? [],
    scorers?.selections ?? [],
    goalNumber,
  );

  const nextGoalNeither = nextGoalLive?.american != null ? nextGoalLive : firstGoalNeither;
  const nextGoalMethod = base.nextGoalMethod?.american != null
    ? base.nextGoalMethod
    : nextGoalNeither;

  return {
    goalTypes: extractGoalTypes(methodSelections),
    noGoalMarkets: {
      ...base,
      ...(nextGoalMethod?.american != null ? { nextGoalMethod } : {}),
      ...(correctScore?.american != null ? { correctScore } : {}),
      ...(totalGoalsUnder?.american != null ? { totalGoalsUnder } : {}),
      ...(nextGoalNeither?.american != null ? { nthGoalNeither: { ...nextGoalNeither, goalNumber } } : {}),
      ...(nextGoalscorer?.american != null ? { nextGoalscorer } : {}),
    },
    marketName: methodMarket?.name ?? nextGoalMethod?.market ?? null,
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
  // Include live matches; only drop fixtures that have already kicked off and finished.
  if (game.inPlay) return true;
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
    leagueId: PL_LEAGUE_ID,
    events: events.map((event) => ({
      eventId: event.eventId,
      name: event.name,
      slug: event.slug,
      openDate: event.openDate ?? null,
    })),
  };
  fs.writeFileSync(DK_EVENT_MAP_FILE, `${JSON.stringify(payload, null, 2)}\n`);
}

async function fetchDkEventMetaQuiet(eventId, attempt = 0) {
  const qs = new URLSearchParams({ eventIds: eventId });
  const res = await fetch(`${DK_NASH_BASE}/sportscontent/pagedata/event/v1/events?${qs}`, {
    headers: nashHeaders({ page: 'league' }),
  });
  if (res.status === 403 && attempt < DK_FETCH_RETRIES - 1) {
    await sleep(DK_FETCH_RETRY_MS * (attempt + 1) + Math.floor(Math.random() * 200));
    return fetchDkEventMetaQuiet(eventId, attempt + 1);
  }
  if (!res.ok) return null;
  const event = (await res.json()).events?.[0];
  if (!event || String(event.leagueId) !== PL_LEAGUE_ID) return null;
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
  const probeEndPad = Number(process.env.DK_PROBE_END_PAD || 25000);
  const start = knownIds.length
    ? Math.min(...knownIds) - 2500
    : Number(process.env.DK_SCAN_START || 34322000);
  const end = Math.max(
    Number(process.env.DK_SCAN_END || 34350000),
    knownIds.length ? Math.max(...knownIds) + probeEndPad : 0,
  );
  const concurrency = Number(process.env.DK_SCAN_CONCURRENCY || 12);
  // Keep this short — a missing event must not hang /SOP for tens of seconds.
  const deadline = Date.now() + Number(process.env.DK_PROBE_TIMEOUT_MS || 5000);

  const neededKeys = new Set(missingGames.map((g) => fixtureTeamKey(g.name)).filter(Boolean));
  const discovered = [];

  for (let base = start; base < end && Date.now() < deadline; base += concurrency) {
    if (neededKeys.size === 0) break;

    const ids = Array.from({ length: Math.min(concurrency, end - base) }, (_, i) => base + i);
    const results = await Promise.all(ids.map((id) => fetchDkEventMetaQuiet(id)));
    for (const event of results) {
      if (!event?.slug) continue;
      slugToId.set(event.slug, event.eventId);
      discovered.push(event);
      neededKeys.delete(slugTeamKey(event.slug));
      neededKeys.delete(fixtureTeamKey(event.name));
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

export async function listDkPremierLeagueEvents() {
  try {
    const payload = await nashFetch(
      `${DK_NASH_BASE}/sportscontent/dkusny/v1/leagues/${PL_LEAGUE_ID}`,
      {
        headerOpts: {
          page: 'league',
          referer: `https://sportsbook.draftkings.com/leagues/soccer/${PL_LEAGUE_SEO}`,
        },
      },
    );
    return (payload.events ?? [])
      .filter((event) => event?.id && event?.name)
      .map((event) => ({
        eventId: String(event.id),
        name: String(event.name).replace(/\s+vs\.?\s+/i, ' v '),
        seoSlug: event.seoIdentifier ?? fdNameToSlug(event.name),
        openDate: event.startEventDate ?? null,
        inPlay: /start|live|in.?play/i.test(String(event.status ?? '')),
      }));
  } catch {
    return [];
  }
}

export async function discoverDkEventsFromLeaguePage() {
  const map = loadStaticDkEventMap();
  try {
    const payload = await nashFetch(
      `${DK_NASH_BASE}/sportscontent/dkusny/v1/leagues/${PL_LEAGUE_ID}`,
      {
        headerOpts: {
          page: 'league',
          referer: `https://sportsbook.draftkings.com/leagues/soccer/${PL_LEAGUE_SEO}`,
        },
      },
    );
    for (const event of payload.events ?? []) {
      if (!event?.id) continue;
      const id = String(event.id);
      const name = event.name ?? '';
      const slug = fdNameToSlug(event.seoIdentifier || name);
      if (slug) map.set(slug, id);
      const vsSlug = fdNameToSlug(name.replace(/\s+vs\.?\s+/i, ' v '));
      if (vsSlug) map.set(vsSlug, id);
      const key = fixtureTeamKey(name.replace(/\s+vs\.?\s+/i, ' v '));
      if (key) map.set(key, id);
    }
  } catch (_) {}
  return map;
}

export function resolveDkEventIdSync(fdGame, slugToId) {
  const slug = fdNameToSlug(fdGame.name);
  if (slugToId.has(slug)) return slugToId.get(slug);

  const gameKey = fixtureTeamKey(fdGame.name);
  if (gameKey && slugToId.has(gameKey)) return slugToId.get(gameKey);

  for (const [mapSlug, eventId] of slugToId.entries()) {
    const normalized = mapSlug.replace(/-v-/g, '-vs-');
    if (normalized === slug.replace(/-v-/g, '-vs-')) return eventId;
    if (gameKey && (mapSlug === gameKey || slugTeamKey(mapSlug) === gameKey)) return eventId;
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

function emptyDkPayload({ timedOut = false, error = null } = {}) {
  const mapMeta = loadStaticDkEventMapMeta();
  return {
    fetchedAt: new Date().toISOString(),
    eventMapUpdatedAt: mapMeta.fetchedAt ?? null,
    timedOut,
    error,
    stats: {
      total: 0,
      withEventId: 0,
      withOdds: 0,
      missingEventId: 0,
      totalEvBets: 0,
    },
    games: [],
  };
}

function buildDkPayload(results, { timedOut = false } = {}) {
  const sorted = [...results].sort((a, b) => {
    if (!a.openDate) return 1;
    if (!b.openDate) return -1;
    return new Date(a.openDate) - new Date(b.openDate);
  });

  const withOdds = sorted.filter((g) => g.goalTypes).length;
  const withEventId = sorted.filter((g) => g.dkEventId).length;
  const evPlus = sorted.reduce((sum, g) => sum + countGameEvBets(g), 0);
  const mapMeta = loadStaticDkEventMapMeta();

  return {
    fetchedAt: new Date().toISOString(),
    eventMapUpdatedAt: mapMeta.fetchedAt ?? null,
    timedOut,
    stats: {
      total: sorted.length,
      withEventId,
      withOdds,
      missingEventId: sorted.length - withEventId,
      totalEvBets: evPlus,
    },
    games: sorted,
  };
}

export async function fetchWorldCupGoalMethodOdds({
  upcomingOnly = true,
  timeoutMs = DK_HANDLER_TIMEOUT_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  const fdPayload = await fetchFanDuelGames();
  if (remaining() <= 0) return emptyDkPayload({ timedOut: true });

  const scheduleGames = upcomingOnly
    ? fdPayload.games.filter(isUpcomingGame)
    : fdPayload.games;
  let slugToId = await discoverDkEventsFromLeaguePage();
  if (remaining() <= 0) return emptyDkPayload({ timedOut: true });

  // Probe is optional and slow — only run when explicitly enabled and we have budget.
  const missingGames = scheduleGames.filter((g) => !resolveDkEventIdSync(g, slugToId));
  if (
    missingGames.length
    && process.env.DK_PROBE_EVENTS === '1'
    && remaining() > 500
  ) {
    slugToId = await probeMissingDkEvents(missingGames, slugToId);
  }

  if (remaining() <= 0) return emptyDkPayload({ timedOut: true });

  const results = await mapPool(scheduleGames, DK_FETCH_CONCURRENCY, async (fdGame) => {
    if (remaining() <= 0) {
      return {
        eventId: fdGame.eventId,
        name: fdGame.name,
        openDate: fdGame.openDate,
        inPlay: fdGame.inPlay,
        score: fdGame.score,
        scoreDisplay: fdGame.scoreDisplay,
        teams: fdGame.teams,
        dkEventId: resolveDkEventIdSync(fdGame, slugToId),
        error: 'DraftKings timed out',
        errorCode: 'timed_out',
      };
    }
    return fetchOneDkGame(fdGame, slugToId);
  });

  return buildDkPayload(results, { timedOut: remaining() <= 0 });
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
    const data = await Promise.race([
      fetchWorldCupGoalMethodOdds({ upcomingOnly }),
      sleep(DK_HANDLER_TIMEOUT_MS + 250).then(() =>
        emptyDkPayload({ timedOut: true, error: 'DraftKings timed out' }),
      ),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[draftkings-goal-method]', err);
    return res.status(200).json(
      emptyDkPayload({ timedOut: true, error: err.message || 'DraftKings fetch failed' }),
    );
  }
}
