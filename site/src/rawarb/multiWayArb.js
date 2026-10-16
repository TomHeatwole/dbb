/**
 * Mutually exclusive outcomes across books: pick best price per leg, sum implieds.
 */

import { formatAmericanOdds } from '../sop/sopModel.js';
import { bookShort } from './bookCatalog.js';
import { quoteFromAmerican } from './rawArbModel.js';
import { formatCombinedPct, formatJuicePct } from './rawArbModel.js';

export const THREE_ML_OUTCOMES = ['away', 'draw', 'home'];

export const OUTCOME_LABELS = {
  away: 'Away',
  draw: 'Draw',
  home: 'Home',
  td: 'TD',
  fg: 'FG',
  punt: 'Punt',
  other: 'Other',
};

function bestLegForOutcome(bookQuotes, outcomeKey) {
  let best = null;
  for (const { id, quote } of bookQuotes) {
    const side = quote?.[outcomeKey];
    const q = quoteFromAmerican(side?.american);
    if (!q) continue;
    const leg = {
      book: id,
      outcomeKey,
      label: side.label || OUTCOME_LABELS[outcomeKey] || outcomeKey,
      american: q.american,
      implied: q.implied,
    };
    if (!best || q.implied < best.implied) best = leg;
  }
  return best;
}

/**
 * @param {string[]} outcomeKeys
 * @param {{ id: string, quote: object }[]} bookQuotes
 */
export function evaluateMultiWayArb(outcomeKeys, bookQuotes) {
  const legs = [];
  for (const key of outcomeKeys) {
    const leg = bestLegForOutcome(bookQuotes, key);
    if (!leg) return null;
    legs.push(leg);
  }
  const pSum = legs.reduce((acc, leg) => acc + leg.implied, 0);
  if (!(pSum > 0)) return null;
  const roi = (1 / pSum) - 1;
  return {
    pSum,
    roi,
    juice: pSum - 1,
    hasArb: pSum < 0.999 && roi > 0,
    legs,
    outcomes: outcomeKeys.length,
  };
}

export function scoreThreeMlMultiWay(row, bookIds) {
  const quotes = (bookIds ?? []).filter((id) => row[id]).map((id) => ({ id, quote: row[id] }));
  if (quotes.length < 2) return null;
  const hasDraw = quotes.some(({ quote }) => quote?.draw?.american != null);
  if (!hasDraw) return null;
  return evaluateMultiWayArb(THREE_ML_OUTCOMES, quotes);
}

export function scoreDriveMultiWay(row, bookIds) {
  const quotes = (bookIds ?? []).filter((id) => row[id]).map((id) => ({ id, quote: row[id] }));
  if (quotes.length < 2) return null;
  const keys = ['td', 'fg', 'punt', 'other'].filter((k) => quotes.some(({ quote }) => quote?.[k]?.american != null));
  if (keys.length < 3) return null;
  return evaluateMultiWayArb(keys, quotes);
}

export function formatMultiWayLegs(multiWay) {
  if (!multiWay?.legs?.length) return '—';
  return multiWay.legs.map((leg) => {
    const book = bookShort(leg.book);
    return `${book} ${leg.label} ${formatAmericanOdds(leg.american)}`;
  }).join(' · ');
}

export { formatCombinedPct, formatJuicePct };
