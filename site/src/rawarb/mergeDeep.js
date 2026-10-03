import { MAIN_KEYS, formatMarketLabel, parseMarketKey } from './marketNormalize.js';
import { mergeContracts } from './extractMarkets.js';
import { pairContract } from './twoWayPairs.js';

function mathKind(kind) {
  if (kind === 'player_ou' || kind === 'team_total') return 'total';
  if (kind === 'yesno') return 'yesno';
  return kind;
}

export function scoreContracts(contracts) {
  const extras = [];
  for (const row of contracts) {
    const paired = pairContract(mathKind(row.kind), row.fd, row.dk);
    const twoWay = paired.best || null;
    const extraArbs = (paired.arbs || []).filter((arb) => arb !== twoWay && arb.hasArb);
    extras.push({
      key: row.key,
      label: formatMarketLabel(row.key, row.label),
      kind: row.kind,
      main: MAIN_KEYS.has(row.key),
      fd: row.fd || null,
      dk: row.dk || null,
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

export function attachDeepMarkets(game, fdContracts, dkContracts) {
  const merged = mergeContracts(fdContracts ?? [], dkContracts ?? []);
  const extras = scoreContracts(merged);
  const extraTwoWays = extras.filter((row) => !row.main && row.twoWay);
  const extraArbs = extraTwoWays.filter((row) => row.twoWay.hasArb);
  const extraBest = extraTwoWays[0]?.twoWay?.pSum ?? null;
  const bestPSum = [game.bestPSum, extraBest].filter((n) => Number.isFinite(n));
  return {
    ...game,
    extras,
    extraArbs,
    bestPSum: bestPSum.length ? Math.min(...bestPSum) : game.bestPSum,
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

export function extraRowsForDisplay(game, { includeArbsInMain = true } = {}) {
  const extras = game.extras ?? [];
  const promoted = [];
  const rest = [];
  for (const row of extras) {
    if (!row.twoWay) continue;
    if (isFullGameMoneyline(row.key)) continue;
    if (row.main) {
      if (!includeArbsInMain) continue;
      const shown = mainMarketOf(game, row.kind)?.twoWay;
      if (row.twoWay.hasArb && !sameLegs(row.twoWay, shown) && altNearMainLine(row, game)) {
        const twLine = row.twoWay.legs?.find((leg) => Number.isFinite(leg.line))?.line;
        const label = Number.isFinite(twLine) ? `${altLabel(row.kind, row.label)} ${twLine}` : altLabel(row.kind, row.label);
        promoted.push({ ...row, label });
      }
      continue;
    }
    if (row.twoWay.hasArb) promoted.push(row);
    else rest.push(row);
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
    const extraBest = extraTwoWays[0]?.twoWay?.pSum ?? att.extraBestPSum ?? null;
    const sums = [game.bestPSum, extraBest].filter((n) => Number.isFinite(n));
    return {
      ...game,
      extras,
      extraArbs,
      extraCount: att.extraCount ?? extraTwoWays.length,
      extraArbCount: att.extraArbCount ?? extraArbs.length,
      bestPSum: sums.length ? Math.min(...sums) : game.bestPSum,
      deepLoaded: true,
    };
  });
}

export function periodOf(key) {
  return parseMarketKey(key).period;
}
