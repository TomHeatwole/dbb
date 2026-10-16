/**
 * Pure TD-arb helpers (safe to import from Jest without API/DB).
 */

import { evaluateTwoWayArb } from '../corners/arbChecker.js';
import { peopleMatch } from '../rawarb/marketNormalize.js';
import { parseSignedAmerican, quoteFromAmerican } from '../rawarb/rawArbModel.js';
import { matchModeForSport } from '../rawarb/sportCatalog.js';
import { teamsMatch } from '../rawarb/teamMatch.js';

const FD_ATD_NAME = /^any time touchdown scorer$/i;
const DK_ATD_NAME = /^anytime td scorer$/i;

export function parseKalshiTdPlayerTitle(title) {
  const m = String(title ?? '').match(/^(.+?):\s*1\+ touchdowns/i);
  return m ? m[1].trim() : null;
}

export function parseKalshiTdEventTeams(title) {
  const m = String(title ?? '').match(/^(.+?)\s+vs\.?\s+(.+?):\s*Touchdowns/i);
  if (!m) return null;
  return { teamA: m[1].trim(), teamB: m[2].trim() };
}

export function kalshiEventMatchesGame(event, game) {
  const parsed = parseKalshiTdEventTeams(event?.title);
  if (!parsed) return false;
  const mode = matchModeForSport(game.sport);
  const { teamA, teamB } = parsed;
  return (
    (teamsMatch(teamA, game.away, mode) && teamsMatch(teamB, game.home, mode))
    || (teamsMatch(teamA, game.home, mode) && teamsMatch(teamB, game.away, mode))
  );
}

export function extractFdAnytimeTd(markets) {
  const rows = [];
  for (const market of Object.values(markets ?? {})) {
    if (!FD_ATD_NAME.test(String(market.marketName ?? ''))) continue;
    for (const runner of Object.values(market.runners ?? {})) {
      const american = parseSignedAmerican(runner?.winRunnerOdds?.americanDisplayOdds?.americanOdds);
      const name = String(runner.runnerName ?? '').trim();
      if (!name || american == null) continue;
      rows.push({ name, american });
    }
  }
  return rows;
}

export function extractDkAnytimeTd(payload) {
  const markets = payload?.markets ?? [];
  const selections = payload?.selections ?? [];
  const atdMarkets = markets.filter((m) => DK_ATD_NAME.test(String(m.name ?? '')));
  const marketIds = new Set(atdMarkets.map((m) => m.id));
  const rowsByEvent = new Map();
  for (const sel of selections) {
    if (!marketIds.has(sel.marketId)) continue;
    const ot = String(sel.outcomeType ?? '');
    if (!/^anytime scorer$/i.test(ot)) continue;
    const american = parseSignedAmerican(sel.displayOdds?.american ?? sel.trueOdds);
    const name = String(sel.label ?? sel.participantName ?? '').trim();
    const eventId = atdMarkets.find((m) => m.id === sel.marketId)?.eventId;
    if (!name || american == null || eventId == null) continue;
    const key = String(eventId);
    if (!rowsByEvent.has(key)) rowsByEvent.set(key, []);
    rowsByEvent.get(key).push({ name, american });
  }
  return rowsByEvent;
}

export function parseKalshiTdMarket(market, kalshiAskToAmerican) {
  if (market?.status !== 'active') return null;
  const name = parseKalshiTdPlayerTitle(market.title);
  if (!name || /protected/i.test(market.title ?? '')) return null;
  const yesAmerican = kalshiAskToAmerican(market.yes_ask_dollars);
  const noAmerican = kalshiAskToAmerican(market.no_ask_dollars);
  if (yesAmerican == null && noAmerican == null) return null;
  return {
    name,
    ticker: market.ticker ?? null,
    title: market.title ?? null,
    yesAmerican,
    noAmerican,
    yesAsk: market.yes_ask_dollars ?? null,
    noAsk: market.no_ask_dollars ?? null,
  };
}

export function findKalshiPlayer(kalshiRows, bookName) {
  const target = String(bookName ?? '').trim();
  if (!target) return null;
  return (kalshiRows ?? []).find((row) => peopleMatch(row.name, target)) ?? null;
}

export function buildPlayerHedge({ name, fd, dk, kalshi }) {
  const bookQuotes = [];
  if (fd?.american != null) {
    const q = quoteFromAmerican(fd.american);
    if (q) bookQuotes.push({ book: 'fd', label: 'Anytime TD', ...q });
  }
  if (dk?.american != null) {
    const q = quoteFromAmerican(dk.american);
    if (q) bookQuotes.push({ book: 'dk', label: 'Anytime TD', ...q });
  }
  bookQuotes.sort((a, b) => a.implied - b.implied);
  const bestBook = bookQuotes[0] ?? null;
  const kalshiNo = kalshi?.noAmerican != null ? quoteFromAmerican(kalshi.noAmerican) : null;
  let hedge = null;
  if (bestBook && kalshiNo) {
    const evald = evaluateTwoWayArb(bestBook, kalshiNo, 100);
    if (evald) {
      hedge = {
        ...evald,
        legs: [
          { book: bestBook.book, label: name, side: 'yes', american: bestBook.american },
          { book: 'kalshi', label: `${name} NO 1+ TD`, side: 'no', american: kalshiNo.american },
        ],
      };
    }
  }
  return {
    name,
    fd: fd ?? null,
    dk: dk ?? null,
    kalshi: kalshi ?? null,
    bestBook: bestBook ? { book: bestBook.book, american: bestBook.american } : null,
    hedge,
    pSum: hedge?.pSum ?? null,
    hasArb: Boolean(hedge?.hasArb),
  };
}

export function mergePlayerRows(fdRows, dkRows, kalshiRows) {
  const names = new Map();
  const upsert = (name, patch) => {
    const key = String(name).trim();
    if (!key) return;
    const prev = names.get(key) ?? { name: key, fd: null, dk: null };
    names.set(key, { ...prev, ...patch, name: key });
  };
  for (const row of fdRows ?? []) upsert(row.name, { fd: { american: row.american } });
  for (const row of dkRows ?? []) upsert(row.name, { dk: { american: row.american } });
  for (const row of kalshiRows ?? []) upsert(row.name, { kalshi: row });

  const out = [];
  for (const entry of names.values()) {
    const kalshi = entry.kalshi ?? findKalshiPlayer(kalshiRows, entry.name);
    out.push(buildPlayerHedge({ ...entry, kalshi }));
  }
  out.sort((a, b) => {
    const ap = a.pSum;
    const bp = b.pSum;
    if (ap == null && bp == null) return a.name.localeCompare(b.name);
    if (ap == null) return 1;
    if (bp == null) return -1;
    return ap - bp;
  });
  return out;
}
