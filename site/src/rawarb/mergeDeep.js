import { MAIN_KEYS, formatMarketLabel, parseMarketKey } from './marketNormalize.js';
import { mergeBookContracts, mergeContracts } from './extractMarkets.js';
import { marketHasMinOdds, pinClosestQuotes, twoWayHasMinOdds } from './rawArbModel.js';
import { isNycBlockedExtra } from './nycFilter.js';
import { pairAmongBooks } from './twoWayPairs.js';

const DEEP_BOOKS = ['fd', 'dk', 'mgm', 'czr'];

const MAIN_FROM_EXTRA = {
  moneyline: (key, sport) => {
    const { period, kind, stat, subject } = parseMarketKey(key);
    if (kind !== 'moneyline' || period !== 'fg' || subject !== 'game') return false;
    if (sport === 'soccer') return stat === 'dnb';
    return stat === 'winner' || stat === 'points';
  },
  spread: (key) => key === 'fg|spread|points|game',
  total: (key) => key === 'fg|total|points|game',
};

function marketHasQuotes(market) {
  if (!market) return false;
  return Boolean(market.fd || market.dk || market.twoWay);
}

export function fillMainsFromExtras(game, extras = []) {
  const next = { ...game };
  for (const kind of ['moneyline', 'spread', 'total']) {
    if (marketHasQuotes(next[kind]) && next[kind]?.twoWay) continue;
    const hit = extras.find((row) => MAIN_FROM_EXTRA[kind](row.key, next.sport) && row.twoWay);
    if (!hit) continue;
    next[kind] = {
      ...(next[kind] || {}),
      fd: pinClosestQuotes(hit.fd) || next[kind]?.fd || null,
      dk: pinClosestQuotes(hit.dk) || next[kind]?.dk || null,
      mgm: pinClosestQuotes(hit.mgm) || next[kind]?.mgm || null,
      czr: pinClosestQuotes(hit.czr) || next[kind]?.czr || null,
      twoWay: hit.twoWay,
    };
  }
  const sums = [next.moneyline?.twoWay?.pSum, next.spread?.twoWay?.pSum, next.total?.twoWay?.pSum]
    .concat(extras.filter((row) => !row.main && row.twoWay).map((row) => row.twoWay.pSum))
    .filter((n) => Number.isFinite(n));
  if (sums.length) next.bestPSum = Math.min(...sums);
  return next;
}

function mathKind(kind) {
  if (kind === 'player_ou' || kind === 'team_total') return 'total';
  if (kind === 'yesno') return 'yesno';
  return kind;
}

export function scoreContracts(contracts, bookIds = DEEP_BOOKS) {
  const ids = (bookIds || DEEP_BOOKS).filter((id) => DEEP_BOOKS.includes(id));
  const extras = [];
  for (const row of contracts) {
    for (const id of ids) {
      if (row[id]) row[id] = pinClosestQuotes(row[id]);
    }
    const quotes = ids.filter((id) => row[id]).map((id) => ({ id, quote: row[id] }));
    const paired = pairAmongBooks(mathKind(row.kind), quotes);
    const twoWay = paired.best || null;
    const extraArbs = (paired.arbs || []).filter((arb) => arb !== twoWay && arb.hasArb);
    extras.push({
      key: row.key,
      label: formatMarketLabel(row.key, row.label),
      kind: row.kind,
      main: MAIN_KEYS.has(row.key),
      fd: row.fd || null,
      dk: row.dk || null,
      mgm: row.mgm || null,
      czr: row.czr || null,
      twoWay,
      arbAlts: extraArbs,
    });
  }
  extras.sort((a, b) => {
    const pa = a.twoWay?.pSum;
    const pb = b.twoWay?.pSum;
    if (pa == null && pb == null) return a.label.localeCompare(b.label);
    if (pa == null) return 1;
    if (pb == null) return -1;
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label);
  });
  return extras;
}

export function rescoreExtras(extras, bookIds = DEEP_BOOKS) {
  const ids = (bookIds || DEEP_BOOKS).filter((id) => DEEP_BOOKS.includes(id));
  const next = (extras || []).map((row) => {
    const pinned = { ...row };
    for (const id of ids) {
      if (pinned[id]) pinned[id] = pinClosestQuotes(pinned[id]);
    }
    const quotes = ids.filter((id) => pinned[id]).map((id) => ({ id, quote: pinned[id] }));
    const paired = pairAmongBooks(mathKind(row.kind), quotes);
    const twoWay = paired.best || null;
    return {
      ...pinned,
      twoWay,
      arbAlts: (paired.arbs || []).filter((arb) => arb !== twoWay && arb.hasArb),
    };
  });
  next.sort((a, b) => {
    const pa = a.twoWay?.pSum;
    const pb = b.twoWay?.pSum;
    if (pa == null && pb == null) return String(a.label).localeCompare(String(b.label));
    if (pa == null) return 1;
    if (pb == null) return -1;
    if (pa !== pb) return pa - pb;
    return String(a.label).localeCompare(String(b.label));
  });
  return next;
}

export function applyEnabledExtras(game, bookIds) {
  if (!game?.extras?.length) return game;
  const extras = rescoreExtras(game.extras, bookIds);
  const extraTwoWays = extras.filter((row) => !row.main && row.twoWay);
  const extraArbs = extraTwoWays.filter((row) => row.twoWay.hasArb);
  return {
    ...game,
    extras,
    extraArbs,
    extraCount: extraTwoWays.length,
    extraArbCount: extraArbs.length,
  };
}

export function attachDeepMarkets(game, fdContracts, dkContracts, extraBooks = {}) {
  let merged = mergeContracts(fdContracts ?? [], dkContracts ?? []);
  for (const [bookId, list] of Object.entries(extraBooks || {})) {
    if (!DEEP_BOOKS.includes(bookId) || bookId === 'fd' || bookId === 'dk') continue;
    merged = mergeBookContracts(merged, list, bookId);
  }
  const extras = scoreContracts(merged);
  const extraTwoWays = extras.filter((row) => !row.main && row.twoWay);
  const extraArbs = extraTwoWays.filter((row) => row.twoWay.hasArb);
  const filled = fillMainsFromExtras(game, extras);
  const extraBest = extraTwoWays[0]?.twoWay?.pSum ?? null;
  const bestPSum = [filled.bestPSum, extraBest].filter((n) => Number.isFinite(n));
  return {
    ...filled,
    extras,
    extraArbs,
    bestPSum: bestPSum.length ? Math.min(...bestPSum) : filled.bestPSum,
    extraCount: extraTwoWays.length,
    extraArbCount: extraArbs.length,
  };
}

function sameLegs(a, b) {
  if (!a?.legs?.length || !b?.legs?.length || a.legs.length !== b.legs.length) return false;
  return a.legs.every((leg, i) => (
    leg.book === b.legs[i].book
    && leg.side === b.legs[i].side
    && leg.american === b.legs[i].american
    && (leg.line ?? null) === (b.legs[i].line ?? null)
  ));
}

function mainMarketOf(game, kind) {
  if (kind === 'moneyline') return game.moneyline;
  if (kind === 'spread') return game.spread;
  if (kind === 'total') return game.total;
  return null;
}

function altLabel(kind, fallback) {
  if (kind === 'spread') return 'Alt spread';
  if (kind === 'total') return 'Alt O/U';
  return fallback;
}

function altNearMainLine(row, game) {
  const twLine = row.twoWay?.legs?.find((leg) => Number.isFinite(leg.line))?.line;
  if (!Number.isFinite(twLine)) return false;
  if (row.kind === 'total') {
    const main = game.total?.fd?.over?.line ?? game.total?.dk?.over?.line;
    return Number.isFinite(main) && Math.abs(twLine - main) <= 6;
  }
  if (row.kind === 'spread') {
    const main = game.spread?.fd?.away?.line ?? game.spread?.dk?.away?.line;
    return Number.isFinite(main) && Math.abs(Math.abs(twLine) - Math.abs(main)) <= 4;
  }
  return true;
}

function isFullGameMoneyline(key) {
  const { period, kind, stat } = parseMarketKey(key);
  return kind === 'moneyline' && period === 'fg' && (stat === 'winner' || stat === 'points');
}

function labeledExtra(row, game) {
  if (!row.main) return row;
  const twLine = row.twoWay?.legs?.find((leg) => Number.isFinite(leg.line))?.line;
  const label = Number.isFinite(twLine) ? `${altLabel(row.kind, row.label)} ${twLine}` : altLabel(row.kind, row.label);
  return { ...row, label };
}

export function extraRowsForDisplay(game, { includeArbsInMain = true, oddsFilter = null, filterNyc = false } = {}) {
  const extras = game.extras ?? [];
  const book = oddsFilter?.book === 'dk' || oddsFilter?.book === 'fd' ? oddsFilter.book : null;
  const minAmerican = oddsFilter?.minAmerican;
  const filtering = Boolean(book && Number.isFinite(minAmerican));
  const promoted = [];
  const rest = [];
  for (const row of extras) {
    if (filterNyc && isNycBlockedExtra(row, game)) continue;
    if (isFullGameMoneyline(row.key)) continue;
    if (filtering) {
      if (marketHasMinOdds(row, book, minAmerican)) promoted.push(labeledExtra(row, game));
      continue;
    }
    if (!row.twoWay) continue;
    if (row.main) {
      if (!includeArbsInMain) continue;
      const shown = mainMarketOf(game, row.kind)?.twoWay;
      if (row.twoWay.hasArb && !sameLegs(row.twoWay, shown) && altNearMainLine(row, game)) {
        promoted.push(labeledExtra(row, game));
      }
      continue;
    }
    if (row.twoWay.hasArb) promoted.push(row);
    else rest.push(row);
  }
  if (filtering) {
    promoted.sort((a, b) => {
      const pa = twoWayHasMinOdds(a.twoWay, book, minAmerican) ? a.twoWay.pSum : Number.POSITIVE_INFINITY;
      const pb = twoWayHasMinOdds(b.twoWay, book, minAmerican) ? b.twoWay.pSum : Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return String(a.label).localeCompare(String(b.label));
    });
  }
  return { promoted, rest };
}

export function applyDeepAttachments(games, attachments) {
  const byFd = new Map();
  const byDk = new Map();
  for (const row of attachments ?? []) {
    if (row.fdEventId != null) byFd.set(String(row.fdEventId), row);
    if (row.dkEventId != null) byDk.set(String(row.dkEventId), row);
  }
  return (games ?? []).map((game) => {
    const att = (game.fdEventId != null && byFd.get(String(game.fdEventId)))
      || (game.dkEventId != null && byDk.get(String(game.dkEventId)));
    if (!att) {
      return {
        ...game,
        extras: [],
        extraArbs: [],
        extraCount: 0,
        extraArbCount: 0,
        deepLoaded: false,
      };
    }
    const extras = att.extras ?? [];
    const extraTwoWays = extras.filter((row) => !row.main && row.twoWay);
    const extraArbs = extraTwoWays.filter((row) => row.twoWay.hasArb);
    const filled = fillMainsFromExtras(game, extras);
    const extraBest = extraTwoWays[0]?.twoWay?.pSum ?? att.extraBestPSum ?? null;
    const sums = [filled.bestPSum, extraBest].filter((n) => Number.isFinite(n));
    return {
      ...filled,
      extras,
      extraArbs,
      extraCount: att.extraCount ?? extraTwoWays.length,
      extraArbCount: att.extraArbCount ?? extraArbs.length,
      bestPSum: sums.length ? Math.min(...sums) : filled.bestPSum,
      deepLoaded: true,
    };
  });
}

export function periodOf(key) {
  return parseMarketKey(key).period;
}
