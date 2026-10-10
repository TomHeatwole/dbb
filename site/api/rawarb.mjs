/**
 * Cross-book two-way mains (FanDuel + DraftKings) for every sport
 * both books list as a two-sided event.
 */

import {
  cachedBook,
  cdnSecondsForMemoryTtl,
  fillBookCache,
  requestIsFresh,
  setNoStore,
  setSharedCacheHeaders,
} from '../lib/bookCache.mjs';
import {
  applyEnabledBooks,
  attachBookGames,
  mergeBookGames,
  parseSignedAmerican,
} from '../src/rawarb/rawArbModel.js';
import { RAW_BOOK_IDS } from '../src/rawarb/bookCatalog.js';
import { fetchMgmGames } from '../lib/rawarb-mgm.mjs';
import { fetchCaesarsGames } from '../lib/rawarb-caesars.mjs';
import {
  DK_LEAGUES,
  FD_EVENT_TYPES,
  SPREAD_MARKET_NAMES,
  TOTAL_MARKET_NAMES,
  dkReferer,
  isSkippableCompetition,
  isSkippableEventName,
  isNonMatchWinnerMarket,
  isThreeWayMoneyline,
  isTwoSidedName,
  isTwoWayWinnerName,
  matchModeForSport,
  mlMarketNamesForSport,
  sportFromFd,
} from '../src/rawarb/sportCatalog.js';
import { parseEventTeams, sidesMatch } from '../src/rawarb/teamMatch.js';

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';

const DK_PE_LOC = 'US-NJ';
const DK_NASH_BASE = `https://sportsbook-nash.draftkings.com/sites/${DK_PE_LOC}-SB/api`;

const FD_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; HwangDynasty-RawArb/1.0)',
};

function dkHeaders(referer) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://sportsbook.draftkings.com',
    Referer: referer,
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'x-client-feature': 'cms',
    'x-client-name': 'web',
    'x-client-page': 'league',
    'x-client-version': '1.14.0',
    'x-pe-cn': 'web',
    'x-pe-cv': '1.14.0',
    'x-pe-ep': 'SB',
    'x-pe-loc': DK_PE_LOC,
  };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

function runnersList(market) {
  const runners = market?.runners;
  if (!runners) return [];
  return Array.isArray(runners) ? runners : Object.values(runners);
}

function fdAmerican(runner) {
  return parseSignedAmerican(runner?.winRunnerOdds?.americanDisplayOdds?.americanOdds);
}

function mapTeamSides(runners, teams, lineFrom, mode = 'loose') {
  const away = runners.find((runner) => sidesMatch(runner.runnerName, teams.away, mode));
  const home = runners.find((runner) => sidesMatch(runner.runnerName, teams.home, mode));
  const pick = (runner, team) => {
    if (!runner) return null;
    const american = fdAmerican(runner);
    if (american == null) return null;
    const line = lineFrom(runner);
    return { american, line: Number.isFinite(line) ? line : null, team: runner.runnerName || team };
  };
  return {
    away: pick(away, teams.away),
    home: pick(home, teams.home),
  };
}

function findMarket(eventMarkets, names) {
  const want = names.map((name) => String(name).toLowerCase());
  return eventMarkets.find((market) => want.includes(String(market.marketName ?? '').toLowerCase())) ?? null;
}

function extractFdEvent(event, markets, sport, league) {
  const teams = parseEventTeams(event.name);
  if (!teams.home || !teams.away) return null;
  const eventMarkets = Object.values(markets ?? {}).filter(
    (market) => Number(market.eventId) === Number(event.eventId),
  );
  const mode = matchModeForSport(sport);
  const ml = findMarket(
    eventMarkets.filter((market) => !isNonMatchWinnerMarket(market.marketName, market._tab)),
    mlMarketNamesForSport(sport),
  );
  const spread = findMarket(eventMarkets, SPREAD_MARKET_NAMES);
  const total = findMarket(eventMarkets, TOTAL_MARKET_NAMES);
  const mlRunners = ml ? runnersList(ml) : [];
  const moneyline = ml && !isThreeWayMoneyline(ml.marketName, mlRunners.map((r) => r.runnerName))
    ? mapTeamSides(mlRunners, teams, () => 0, mode)
    : null;
  const spreadSides = spread
    ? mapTeamSides(runnersList(spread), teams, (runner) => Number(runner.handicap), mode)
    : null;
  let totalSides = null;
  if (total) {
    const over = runnersList(total).find((runner) => /^over$/i.test(String(runner.runnerName ?? '')));
    const under = runnersList(total).find((runner) => /^under$/i.test(String(runner.runnerName ?? '')));
    const pack = (runner) => {
      if (!runner) return null;
      const american = fdAmerican(runner);
      if (american == null) return null;
      const line = Number(runner.handicap);
      return { american, line: Number.isFinite(line) ? line : null };
    };
    totalSides = { over: pack(over), under: pack(under) };
  }
  const hasAny = [moneyline?.away, moneyline?.home, spreadSides?.away, spreadSides?.home, totalSides?.over, totalSides?.under]
    .some(Boolean);
  if (!hasAny) {
    return {
      eventId: String(event.eventId),
      home: teams.home,
      away: teams.away,
      sport,
      league,
      openDate: event.openDate ?? null,
      inPlay: Boolean(event.inPlay),
      moneyline: null,
      spread: null,
      total: null,
    };
  }
  return {
    eventId: String(event.eventId),
    home: teams.home,
    away: teams.away,
    sport,
    league,
    openDate: event.openDate ?? null,
    inPlay: Boolean(event.inPlay),
    moneyline,
    spread: spreadSides,
    total: totalSides,
  };
}

function extractFdPayload(payload) {
  const competitions = payload?.attachments?.competitions ?? {};
  const markets = payload?.attachments?.markets ?? {};
  const games = [];
  for (const [id, ev] of Object.entries(payload?.attachments?.events ?? {})) {
    const name = ev?.name ?? '';
    if (!isTwoSidedName(name) || isSkippableEventName(name)) continue;
    const comp = competitions[ev.competitionId] || competitions[String(ev.competitionId)] || {};
    const compName = comp.name || '';
    if (isSkippableCompetition(compName)) continue;
    const sport = sportFromFd(ev.eventTypeId, ev.competitionId, compName);
    if (!sport) continue;
    const extracted = extractFdEvent({
      eventId: Number(id),
      name,
      openDate: ev.openDate ?? null,
      inPlay: Boolean(ev.inPlay),
    }, markets, sport, compName || null);
    if (extracted) games.push(extracted);
  }
  return games;
}

function dkAmerican(selection) {
  return parseSignedAmerican(selection?.displayOdds?.american);
}

function extractDkLeague(payload, sport, leagueName) {
  const selectionsByMarket = new Map();
  for (const sel of payload?.selections ?? []) {
    const mid = String(sel.marketId ?? '');
    if (!mid) continue;
    if (!selectionsByMarket.has(mid)) selectionsByMarket.set(mid, []);
    selectionsByMarket.get(mid).push(sel);
  }
  const marketsByEvent = new Map();
  for (const market of payload?.markets ?? []) {
    const eid = market.eventId != null ? String(market.eventId) : '';
    if (!eid) continue;
    if (!marketsByEvent.has(eid)) marketsByEvent.set(eid, []);
    marketsByEvent.get(eid).push(market);
  }
  const games = [];
  for (const event of payload?.events ?? []) {
    if (!event?.id || !event?.name) continue;
    if (!isTwoSidedName(event.name) || isSkippableEventName(event.name)) continue;
    const teams = parseEventTeams(String(event.name));
    if (!teams.home || !teams.away) continue;
    const markets = marketsByEvent.get(String(event.id)) ?? [];
    const sels = (market) => (market ? selectionsByMarket.get(String(market.id)) ?? [] : []);
    const mode = matchModeForSport(sport);
    const byNames = (names, { moneyline: wantMl = false } = {}) => {
      const hits = markets.filter((market) => (
        names.some((name) => String(market.name ?? '').toLowerCase() === name.toLowerCase())
      ));
      if (!wantMl) return hits[0] ?? null;
      const ranked = hits.map((market) => {
        const list = sels(market);
        const americans = list.map(dkAmerican).filter((n) => n != null);
        if (isNonMatchWinnerMarket(market.name, market.subcategoryName || market.hint)) return 5;
        if (americans.length < 2) return 4;
        if (americans.every((n) => n > 0) && !isTwoWayWinnerName(market.name)) return 3;
        return 0;
      });
      let best = -1;
      ranked.forEach((rank, idx) => {
        if (rank < 3 && (best < 0 || rank < ranked[best])) best = idx;
      });
      return best >= 0 ? hits[best] : null;
    };

    const teamSide = (list, team, role) => {
      const named = list.find((sel) => sidesMatch(sel.label, team, mode));
      const hit = named || list.find((sel) => {
        const lab = String(sel.label ?? '').trim();
        if (lab && !/^(away|home)$/i.test(lab)) return false;
        return role && String(sel.outcomeType ?? '').toLowerCase() === role;
      });
      if (!hit) return null;
      const american = dkAmerican(hit);
      if (american == null) return null;
      const line = Number(hit.points);
      const label = String(hit.label ?? '').trim();
      return {
        american,
        line: Number.isFinite(line) ? line : null,
        team: label && !/^(away|home)$/i.test(label) ? label : team,
      };
    };
    const ouSide = (list, role) => {
      const hit = list.find((sel) => String(sel.outcomeType ?? '').toLowerCase() === role
        || String(sel.label ?? '').toLowerCase() === role);
      if (!hit) return null;
      const american = dkAmerican(hit);
      if (american == null) return null;
      const line = Number(hit.points);
      return { american, line: Number.isFinite(line) ? line : null };
    };

    const mlMarket = byNames(mlMarketNamesForSport(sport), { moneyline: true });
    const mlSels = sels(mlMarket);
    const skipMl = mlMarket && isThreeWayMoneyline(
      mlMarket.name,
      mlSels.map((sel) => sel.label),
    );
    const spreadSels = sels(byNames(SPREAD_MARKET_NAMES));
    const totalSels = sels(byNames(TOTAL_MARKET_NAMES));
    const moneyline = skipMl ? { away: null, home: null } : {
      away: teamSide(mlSels, teams.away, 'away'),
      home: teamSide(mlSels, teams.home, 'home'),
    };
    if (
      moneyline.away && moneyline.home
      && moneyline.away.american > 0 && moneyline.home.american > 0
      && !isTwoWayWinnerName(mlMarket?.name)
    ) {
      moneyline.away = null;
      moneyline.home = null;
    }
    const spread = {
      away: teamSide(spreadSels, teams.away, 'away'),
      home: teamSide(spreadSels, teams.home, 'home'),
    };
    const total = {
      over: ouSide(totalSels, 'over'),
      under: ouSide(totalSels, 'under'),
    };
    games.push({
      eventId: String(event.id),
      home: teams.home,
      away: teams.away,
      sport,
      league: leagueName || null,
      leagueId: String(event.leagueId ?? payload?.leagues?.[0]?.id ?? ''),
      openDate: event.startEventDate ?? null,
      inPlay: String(event.status ?? '').toUpperCase() === 'STARTED',
      moneyline,
      spread,
      total,
    });
  }
  return games;
}

async function fdFetch(eventTypeId) {
  const res = await fetch(
    `${FD_BASE}/content-managed-page?${FD_QUERY}&page=SPORT&eventTypeId=${eventTypeId}`,
    { headers: FD_HEADERS },
  );
  if (!res.ok) throw new Error(`FanDuel eventType ${eventTypeId} returned ${res.status}`);
  return res.json();
}

async function dkFetch(league) {
  const res = await fetch(`${DK_NASH_BASE}/sportscontent/dkusny/v1/leagues/${league.id}`, {
    headers: dkHeaders(dkReferer(league)),
  });
  if (!res.ok) throw new Error(`DraftKings ${league.path} returned ${res.status}`);
  return res.json();
}

function compactError(err) {
  return String(err?.message || err || 'fetch failed').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function fetchRawArbBook() {
  const [fdResults, dkResults, mgmResult, czrResult] = await Promise.all([
    mapPool(FD_EVENT_TYPES, 5, async (row) => {
      try {
        return { ok: true, eventTypeId: row.id, payload: await fdFetch(row.id) };
      } catch (err) {
        return { ok: false, eventTypeId: row.id, error: compactError(err) };
      }
    }),
    mapPool(DK_LEAGUES, 8, async (league) => {
      try {
        return { ok: true, league, payload: await dkFetch(league) };
      } catch (err) {
        return { ok: false, league, error: compactError(err) };
      }
    }),
    fetchMgmGames().catch((err) => ({ games: [], notices: [`BetMGM: ${compactError(err)}`] })),
    fetchCaesarsGames().catch((err) => ({ games: [], notices: [`Caesars: ${compactError(err)}`] })),
  ]);

  const notices = [...(mgmResult.notices || []), ...(czrResult.notices || [])];
  const fdBySport = new Map();
  for (const row of fdResults) {
    if (!row.ok) {
      notices.push(`FanDuel ${row.eventTypeId}: ${row.error}`);
      continue;
    }
    for (const game of extractFdPayload(row.payload)) {
      if (!fdBySport.has(game.sport)) fdBySport.set(game.sport, []);
      fdBySport.get(game.sport).push(game);
    }
  }

  const dkBySport = new Map();
  for (const row of dkResults) {
    if (!row.ok) {
      notices.push(`DraftKings ${row.league.path}: ${row.error}`);
      continue;
    }
    const leagueName = row.payload?.leagues?.[0]?.name || row.league.path;
    for (const game of extractDkLeague(row.payload, row.league.sport, leagueName)) {
      if (!dkBySport.has(game.sport)) dkBySport.set(game.sport, []);
      dkBySport.get(game.sport).push(game);
    }
  }

  const sports = new Set([...fdBySport.keys(), ...dkBySport.keys()]);
  let games = [];
  for (const sport of sports) {
    games.push(...mergeBookGames(fdBySport.get(sport) ?? [], dkBySport.get(sport) ?? [], sport));
  }
  games = attachBookGames(games, mgmResult.games || [], 'mgm');
  games = attachBookGames(games, czrResult.games || [], 'czr');
  games = games.map((game) => applyEnabledBooks(game, RAW_BOOK_IDS));

  const fetchedAt = new Date().toISOString();
  const bySport = {};
  for (const game of games) {
    bySport[game.sport] = (bySport[game.sport] || 0) + 1;
  }
  return {
    fetchedAt,
    games,
    notices,
    stats: {
      games: games.length,
      bySport,
      withBothBooks: games.filter((g) => g.fdEventId && g.dkEventId).length,
      withMgm: games.filter((g) => g.mgmEventId).length,
      withCzr: games.filter((g) => g.czrEventId).length,
      withTwoWay: games.filter((g) => g.bestPSum != null).length,
      cfb: bySport.cfb || 0,
      nfl: bySport.nfl || 0,
    },
  };
}

function wantsDeep(req) {
  const q = req.query || {};
  if (q.deep === '1' || q.deep === 'true') return true;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    if (url.searchParams.get('deep') === '1' || url.searchParams.get('deep') === 'true') return true;
    return /\/rawarb-deep\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // /api/rawarb-deep is the same function: ?deep=1 (Hobby plan, 12 functions max).
  if (wantsDeep(req)) {
    const { default: deepHandler } = await import('../lib/rawarb-deep.mjs');
    return deepHandler(req, res);
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const fresh = requestIsFresh(req);
    const ttlMs = 60_000;
    const data = fresh
      ? await fetchRawArbBook()
      : await cachedBook('rawarb-v4', fetchRawArbBook, () => ttlMs, { persist: true });
    if (fresh) {
      await fillBookCache('rawarb-v4', data, ttlMs, { persist: true });
      setNoStore(res);
    } else {
      setSharedCacheHeaders(res, cdnSecondsForMemoryTtl(ttlMs));
    }
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rawarb]', err);
    return res.status(502).json({ error: err.message || 'Raw arb fetch failed' });
  }
}
