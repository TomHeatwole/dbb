/**
 * Plain-text SOP +EV dump for /sop-static.txt scrapers.
 * Uses the longest no-goal proxy (same as the Book monitor).
 */

import {
  analyzeAgainstBreakeven,
  computeBreakevenOdds,
  computeKellyFraction,
  formatAmericanOdds,
  GOAL_TYPE_META,
  NO_GOAL_SOURCE_KEYS,
} from './sopModel.js';
import { bookTag, liveClockLabel, shortGameName } from './gameSnapshot.js';
import { findLongestNoGoalPick, quoteForNoGoalBook } from './longestNoGoalPick.js';

export const NO_GOAL_SOURCE_LABELS = {
  [NO_GOAL_SOURCE_KEYS.nextGoalMethod]: 'Next Goal Method',
  [NO_GOAL_SOURCE_KEYS.correctScore]: 'Correct Score',
  [NO_GOAL_SOURCE_KEYS.totalGoalsUnder]: 'Total Goals Under',
  [NO_GOAL_SOURCE_KEYS.nthGoalNeither]: 'Nth Goal Neither',
  [NO_GOAL_SOURCE_KEYS.nextGoalscorer]: 'Next Goalscorer',
};

function noGoalSourceDetail(sourceKey, quote) {
  if (!quote) return null;
  if (sourceKey === NO_GOAL_SOURCE_KEYS.correctScore && quote.scoreUsed) {
    return quote.scoreUsed;
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.totalGoalsUnder && quote.line != null) {
    return `U ${quote.line}`;
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.nthGoalNeither) {
    if (quote.goalNumber != null) return `G${quote.goalNumber}`;
    if (quote.selection) return quote.selection;
  }
  if (quote.selection) return quote.selection;
  return null;
}

export function formatNoGoalProxy(sourceKey, book, quote, american) {
  const source = NO_GOAL_SOURCE_LABELS[sourceKey] ?? sourceKey ?? 'No Goal';
  const detail = noGoalSourceDetail(sourceKey, quote);
  const odds = Number.isFinite(american) ? formatAmericanOdds(american) : '—';
  const parts = [bookTag(book), source];
  if (detail) parts.push(detail);
  parts.push(odds);
  return parts.join(' ');
}

function collectGoalTypeOffers(game) {
  const allowDk = !game?.inPlay;
  const offers = [];
  for (const { key, label } of GOAL_TYPE_META) {
    const fdAmerican = game?.goalTypes?.[key]?.american ?? null;
    if (Number.isFinite(fdAmerican)) {
      offers.push({ key, label, book: 'fd', american: fdAmerican });
    }
    const dkAmerican = allowDk ? game?.dk?.goalTypes?.[key]?.american ?? null : null;
    if (Number.isFinite(dkAmerican)) {
      offers.push({ key, label, book: 'dk', american: dkAmerican });
    }
  }
  return offers;
}

export function collectProfitableSopEdges(game) {
  const longest = findLongestNoGoalPick(game);
  const quote = quoteForNoGoalBook(game, longest.sourceKey, longest.book);
  const american = Number.isFinite(quote?.american)
    ? quote.american
    : (Number.isFinite(longest.american) ? longest.american : null);
  const model = Number.isFinite(american) ? computeBreakevenOdds(american) : null;
  if (!model) return null;

  const edges = [];
  for (const offer of collectGoalTypeOffers(game)) {
    const breakeven = model[offer.key];
    const analysis = Number.isFinite(breakeven?.american)
      ? analyzeAgainstBreakeven(offer.american, breakeven.american)
      : null;
    if (!analysis?.profitable || !Number.isFinite(analysis.edgePoints)) continue;

    const winProb = breakeven?.implied != null ? breakeven.implied / 100 : null;
    const kellyFraction = winProb != null
      ? computeKellyFraction(winProb, offer.american)
      : null;

    edges.push({
      market: offer.label,
      book: offer.book,
      offeredAmerican: offer.american,
      breakevenAmerican: analysis.breakevenAmerican,
      edgePoints: analysis.edgePoints,
      kellyFraction,
    });
  }

  if (!edges.length) return null;
  edges.sort((a, b) => (b.edgePoints ?? 0) - (a.edgePoints ?? 0));

  return {
    name: shortGameName(game),
    fullName: game?.name ?? shortGameName(game),
    score: game?.scoreDisplay ?? '0-0',
    clock: liveClockLabel(game),
    inPlay: Boolean(game?.inPlay),
    competition: game?.competition ?? 'pl',
    noGoal: {
      sourceKey: longest.sourceKey,
      book: longest.book,
      american,
      label: formatNoGoalProxy(longest.sourceKey, longest.book, quote, american),
    },
    edges,
  };
}

export function formatKellyPercent(kellyFraction) {
  if (!Number.isFinite(kellyFraction) || kellyFraction <= 0) return '—';
  return `${(kellyFraction * 100).toFixed(2)}%`;
}

export function formatEdgePercent(edgePoints) {
  if (!Number.isFinite(edgePoints)) return '—';
  const sign = edgePoints > 0 ? '+' : '';
  return `${sign}${edgePoints.toFixed(1)}%`;
}

function formatGameHeading(row) {
  const bits = [row.fullName || row.name];
  if (row.score) bits.push(row.score);
  if (row.inPlay) bits.push('LIVE');
  if (row.clock) bits.push(row.clock);
  if (row.competition === 'ucl') bits.push('UCL');
  return bits.join('  ');
}

function formatEdgeLine(edge) {
  const kelly = formatKellyPercent(edge.kellyFraction);
  return [
    edge.market,
    bookTag(edge.book),
    formatAmericanOdds(edge.offeredAmerican),
    `edge ${formatEdgePercent(edge.edgePoints)}`,
    `kelly ${kelly}`,
    `be ${formatAmericanOdds(edge.breakevenAmerican)}`,
  ].join('  ');
}

export function formatSopStaticText({
  games = [],
  fetchedAt = null,
  notices = [],
} = {}) {
  const rows = (games ?? [])
    .map(collectProfitableSopEdges)
    .filter(Boolean);

  const lines = [
    'SOP +EV edges',
    fetchedAt ? `fetched ${fetchedAt}` : `fetched ${new Date().toISOString()}`,
    'no-goal = longest proxy across FD / DK / Kalshi',
    'kelly = full Kelly as % of bankroll',
  ];

  for (const notice of notices ?? []) {
    if (notice) lines.push(notice);
  }

  lines.push('');

  if (!rows.length) {
    lines.push('No profitable edges.');
    lines.push('');
    return lines.join('\n');
  }

  for (const row of rows) {
    lines.push(formatGameHeading(row));
    lines.push(`  no-goal: ${row.noGoal.label}`);
    for (const edge of row.edges) {
      lines.push(`  ${formatEdgeLine(edge)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
