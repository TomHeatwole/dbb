/**
 * Cross-book CFB + NFL main lines (FanDuel + DraftKings).
 * Moneyline, spread, and game total only — no props.
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
  mergeBookGames,
  parseSignedAmerican,
} from '../src/rawarb/rawArbModel.js';
import { parseEventTeams, teamsMatch } from '../src/rawarb/teamMatch.js';

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';
const FD_FOOTBALL_EVENT_TYPE = 6423;
const FD_COMPETITIONS = {
  nfl: 12282733,
  cfb: 12529073,
};

const DK_PE_LOC = 'US-NJ';
const DK_NASH_BASE = `https://sportsbook-nash.draftkings.com/sites/${DK_PE_LOC}-SB/api`;
const DK_LEAGUES = {
  nfl: { id: '88808', referer: 'https://sportsbook.draftkings.com/leagues/football/nfl' },
  cfb: { id: '87637', referer: 'https://sportsbook.draftkings.com/leagues/football/ncaaf' },
};

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

function runnersList(market) {
  const runners = market?.runners;
  if (!runners) return [];
  return Array.isArray(runners) ? runners : Object.values(runners);
}

function fdAmerican(runner) {
  return parseSignedAmerican(runner?.winRunnerOdds?.americanDisplayOdds?.americanOdds);
}

function mapTeamSides(runners, teams, lineFrom) {
  const away = runners.find((runner) => teamsMatch(runner.runnerName, teams.away));
  const home = runners.find((runner) => teamsMatch(runner.runnerName, teams.home));
  const pick = (runner, team) => {
    if (!runner) return null;
    const american = fdAmerican(runner);
    if (american == null) return null;
    const line = lineFrom(runner);
    return { american, line: Number.isFinite(line) ? line : null, team };
  };
  return {
    away: pick(away, teams.away),
    home: pick(home, teams.home),
  };
}

function extractFdEvent(event, markets) {
  const teams = parseEventTeams(event.name);
  if (!teams.home || !teams.away) return null;
  const eventMarkets = Object.values(markets ?? {}).filter(
    (market) => Number(market.eventId) === Number(event.eventId),
  );
  const byName = (names) => eventMarkets.find((market) => names.includes(String(market.marketName ?? ''))) ?? null;
  const ml = byName(['Moneyline']);
  const spread = byName(['Spread']);
  const total = byName(['Total Points', 'Total']);
  const moneyline = ml ? mapTeamSides(runnersList(ml), teams, () => 0) : null;
  const spreadSides = spread
    ? mapTeamSides(runnersList(spread), teams, (runner) => Number(runner.handicap))
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
  if (!hasAny) return null;
  return {
    eventId: String(event.eventId),
    home: teams.home,
    away: teams.away,
    openDate: event.openDate ?? null,
    inPlay: Boolean(event.inPlay),
    moneyline,
    spread: spreadSides,
    total: totalSides,
  };
}

function extractFdSport(payload, sport) {
  const competitionId = FD_COMPETITIONS[sport];
  const events = Object.entries(payload?.attachments?.events ?? {})
    .filter(([, ev]) => Number(ev.competitionId) === competitionId)
    .map(([id, ev]) => ({
      eventId: Number(id),
      name: ev.name,
      openDate: ev.openDate ?? null,
      inPlay: Boolean(ev.inPlay),
    }));
  const markets = payload?.attachments?.markets ?? {};
  return events.map((event) => extractFdEvent(event, markets)).filter(Boolean);
}

function dkAmerican(selection) {
  return parseSignedAmerican(selection?.displayOdds?.american);
}

function extractDkLeague(payload) {
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
    const teams = parseEventTeams(String(event.name).replace(/\s+vs\.?\s+/i, ' @ '));
    if (!teams.home || !teams.away) continue;
    const markets = marketsByEvent.get(String(event.id)) ?? [];
    const byName = (name) => markets.find((market) => String(market.name ?? '') === name) ?? null;
    const sels = (market) => (market ? selectionsByMarket.get(String(market.id)) ?? [] : []);

    const teamSide = (list, team, role) => {
      const hit = list.find((sel) => {
        const outcome = String(sel.outcomeType ?? '').toLowerCase();
        if (role && outcome === role) return true;
        return teamsMatch(sel.label, team);
      });
      if (!hit) return null;
      const american = dkAmerican(hit);
      if (american == null) return null;
      const line = Number(hit.points);
      return { american, line: Number.isFinite(line) ? line : null, team };
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

    const mlSels = sels(byName('Moneyline'));
    const spreadSels = sels(byName('Spread'));
    const totalSels = sels(byName('Total'));
    const moneyline = {
      away: teamSide(mlSels, teams.away, 'away'),
      home: teamSide(mlSels, teams.home, 'home'),
    };
    const spread = {
      away: teamSide(spreadSels, teams.away, 'away'),
      home: teamSide(spreadSels, teams.home, 'home'),
    };
    const total = {
      over: ouSide(totalSels, 'over'),
      under: ouSide(totalSels, 'under'),
    };
    const hasAny = [moneyline.away, moneyline.home, spread.away, spread.home, total.over, total.under].some(Boolean);
    if (!hasAny) continue;
    games.push({
      eventId: String(event.id),
      home: teams.home,
      away: teams.away,
      openDate: event.startEventDate ?? null,
      inPlay: String(event.status ?? '').toUpperCase() === 'STARTED',
      moneyline,
      spread,
      total,
    });
  }
  return games;
}

async function fdFetch() {
  const res = await fetch(
    `${FD_BASE}/content-managed-page?${FD_QUERY}&page=SPORT&eventTypeId=${FD_FOOTBALL_EVENT_TYPE}`,
    { headers: FD_HEADERS },
  );
  if (!res.ok) throw new Error(`FanDuel football page returned ${res.status}`);
  return res.json();
}

async function dkFetch(sport) {
  const league = DK_LEAGUES[sport];
  const res = await fetch(`${DK_NASH_BASE}/sportscontent/dkusny/v1/leagues/${league.id}`, {
    headers: dkHeaders(league.referer),
  });
  if (!res.ok) throw new Error(`DraftKings ${sport} returned ${res.status}`);
  return res.json();
}

function compactError(err) {
  return String(err?.message || err || 'fetch failed').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function fetchRawArbBook() {
  const [fdResult, nflDkResult, cfbDkResult] = await Promise.allSettled([
    fdFetch(),
    dkFetch('nfl'),
    dkFetch('cfb'),
  ]);

  const notices = [];
  const fdPayload = fdResult.status === 'fulfilled' ? fdResult.value : null;
  if (fdResult.status === 'rejected') notices.push(`FanDuel: ${compactError(fdResult.reason)}`);

  const dkNfl = nflDkResult.status === 'fulfilled' ? extractDkLeague(nflDkResult.value) : [];
  if (nflDkResult.status === 'rejected') notices.push(`DraftKings NFL: ${compactError(nflDkResult.reason)}`);

  const dkCfb = cfbDkResult.status === 'fulfilled' ? extractDkLeague(cfbDkResult.value) : [];
  if (cfbDkResult.status === 'rejected') notices.push(`DraftKings CFB: ${compactError(cfbDkResult.reason)}`);

  const fdNfl = fdPayload ? extractFdSport(fdPayload, 'nfl') : [];
  const fdCfb = fdPayload ? extractFdSport(fdPayload, 'cfb') : [];

  const games = [
    ...mergeBookGames(fdCfb, dkCfb, 'cfb'),
    ...mergeBookGames(fdNfl, dkNfl, 'nfl'),
  ];

  const fetchedAt = new Date().toISOString();
  return {
    fetchedAt,
    games,
    notices,
    stats: {
      games: games.length,
      cfb: games.filter((g) => g.sport === 'cfb').length,
      nfl: games.filter((g) => g.sport === 'nfl').length,
      withBothBooks: games.filter((g) => g.fdEventId && g.dkEventId).length,
      withTwoWay: games.filter((g) => g.bestPSum != null).length,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const fresh = requestIsFresh(req);
    const ttlMs = 60_000;
    const data = fresh
      ? await fetchRawArbBook()
      : await cachedBook('rawarb', fetchRawArbBook, () => ttlMs, { persist: true });
    if (fresh) {
      await fillBookCache('rawarb', data, ttlMs, { persist: true });
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
