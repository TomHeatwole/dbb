/**
 * Anytime TD: FanDuel + DraftKings vs Kalshi NO on 1+ touchdowns (KXNFLTD).
 */

import { fetchRawArbBook } from '../api/rawarb.mjs';
import {
  extractDkAnytimeTd,
  extractFdAnytimeTd,
  kalshiEventMatchesGame,
  mergePlayerRows,
  parseKalshiTdMarket,
} from '../src/tdarb/tdArbCore.js';
import { dkReferer } from '../src/rawarb/sportCatalog.js';
import {
  fetchAllKalshiEvents,
  fetchMarketsForEvent,
  kalshiAskToAmerican,
  pickKalshiEvent,
} from './kalshi-sop.mjs';

export {
  buildPlayerHedge,
  extractDkAnytimeTd,
  extractFdAnytimeTd,
  findKalshiPlayer,
  kalshiEventMatchesGame,
  mergePlayerRows,
  parseKalshiTdEventTeams,
  parseKalshiTdPlayerTitle,
} from '../src/tdarb/tdArbCore.js';

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';
const FD_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; HwangDynasty-TDArb/1.0)',
};

const DK_PE_LOC = 'US-NJ';
const DK_NASH_BASE = `https://sportsbook-nash.draftkings.com/sites/${DK_PE_LOC}-SB/api`;
const NFL_LEAGUE = { id: '88808', sport: 'nfl', path: 'football/nfl' };
const DK_TD_CAT = 1003;
const DK_TD_SUB = 12438;

const KALSHI_TD_SERIES = 'KXNFLTD';

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

async function fetchJson(url, headers, ms = 14000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function dkHeaders(league) {
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://sportsbook.draftkings.com',
    Referer: dkReferer(league),
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

export function pickKalshiTdEventForGame(events, game) {
  const candidates = (events ?? []).filter((event) => kalshiEventMatchesGame(event, game));
  return pickKalshiEvent(candidates, game.openDate);
}

function pickNflGames(games) {
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;
  return (games ?? [])
    .filter((g) => g.sport === 'nfl')
    .filter((g) => g.inPlay || !g.openDate || Date.parse(g.openDate) <= horizon)
    .sort((a, b) => {
      if (a.inPlay !== b.inPlay) return a.inPlay ? -1 : 1;
      return (Date.parse(a.openDate) || 0) - (Date.parse(b.openDate) || 0);
    });
}

async function fetchFdTdTab(eventId) {
  const url = `${FD_BASE}/event-page?${FD_QUERY}&eventId=${eventId}&tab=td-scorer-props`;
  const json = await fetchJson(url, FD_HEADERS);
  return extractFdAnytimeTd(json?.attachments?.markets);
}

async function fetchDkNflAnytimeTd() {
  const url = `${DK_NASH_BASE}/sportscontent/dkusny/v1/leagues/${NFL_LEAGUE.id}?categoryId=${DK_TD_CAT}&subcategoryId=${DK_TD_SUB}`;
  const json = await fetchJson(url, dkHeaders(NFL_LEAGUE), 20000);
  return extractDkAnytimeTd(json ?? {});
}

async function fetchAllKalshiTdMarkets(eventTicker) {
  const markets = await fetchMarketsForEvent(eventTicker);
  return (markets ?? [])
    .map((m) => parseKalshiTdMarket(m, kalshiAskToAmerican))
    .filter(Boolean);
}

export async function fetchTdArbBook() {
  const notices = [];
  const [rawBook, kalshiEvents, dkByEvent] = await Promise.all([
    fetchRawArbBook(),
    fetchAllKalshiEvents(KALSHI_TD_SERIES).catch((err) => {
      notices.push(`Kalshi: ${err.message || 'fetch failed'}`);
      return [];
    }),
    fetchDkNflAnytimeTd().catch((err) => {
      notices.push(`DraftKings TD: ${err.message || 'fetch failed'}`);
      return new Map();
    }),
  ]);

  notices.push(...(rawBook.notices ?? []));

  const nflGames = pickNflGames(rawBook.games);
  const fdRows = await mapPool(
    nflGames.filter((g) => g.fdEventId),
    6,
    async (game) => ({
      game,
      rows: await fetchFdTdTab(game.fdEventId).catch(() => []),
    }),
  );

  const fdByEvent = new Map(fdRows.map(({ game, rows }) => [String(game.fdEventId), rows]));

  const games = [];
  let playerCount = 0;
  let withKalshi = 0;
  let withHedge = 0;
  let arbCount = 0;

  for (const game of nflGames) {
    const kalshiEvent = pickKalshiTdEventForGame(kalshiEvents, game);
    let kalshiRows = [];
    if (kalshiEvent?.event_ticker) {
      try {
        kalshiRows = await fetchAllKalshiTdMarkets(kalshiEvent.event_ticker);
      } catch (err) {
        notices.push(`Kalshi ${game.away} @ ${game.home}: ${err.message || 'markets failed'}`);
      }
    }
    const fd = fdByEvent.get(String(game.fdEventId)) ?? [];
    const dk = game.dkEventId ? (dkByEvent.get(String(game.dkEventId)) ?? []) : [];
    const players = mergePlayerRows(fd, dk, kalshiRows);
    playerCount += players.length;
    if (kalshiRows.length) withKalshi += 1;
    const hedged = players.filter((p) => p.hedge);
    withHedge += hedged.length;
    arbCount += players.filter((p) => p.hasArb).length;
    const bestPSum = players.find((p) => p.pSum != null)?.pSum ?? null;

    games.push({
      away: game.away,
      home: game.home,
      sport: game.sport,
      openDate: game.openDate,
      inPlay: game.inPlay,
      fdEventId: game.fdEventId ?? null,
      dkEventId: game.dkEventId ?? null,
      kalshiEventTicker: kalshiEvent?.event_ticker ?? null,
      kalshiEventTitle: kalshiEvent?.title ?? null,
      bestPSum,
      players,
    });
  }

  games.sort((a, b) => {
    const ap = a.bestPSum;
    const bp = b.bestPSum;
    if (ap == null && bp == null) return (Date.parse(a.openDate) || 0) - (Date.parse(b.openDate) || 0);
    if (ap == null) return 1;
    if (bp == null) return -1;
    return ap - bp;
  });

  return {
    fetchedAt: new Date().toISOString(),
    notices,
    stats: {
      games: games.length,
      players: playerCount,
      withKalshi,
      withHedge,
      arbs: arbCount,
    },
    games,
  };
}
