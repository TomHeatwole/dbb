/**
 * Client helpers for TD arb table (books YES + Kalshi NO).
 */

import { formatAmericanOdds } from '../sop/sopModel.js';
import { bookShort } from '../rawarb/bookCatalog.js';
import { formatCombinedPct, formatJuicePct, parseSignedAmerican } from '../rawarb/rawArbModel.js';

export function filterGames(games, timing) {
  const list = games ?? [];
  if (timing === 'live') return list.filter((g) => g.inPlay);
  if (timing === 'upcoming') return list.filter((g) => !g.inPlay);
  return list;
}

export function filterPlayers(players, { minAmerican, book } = {}) {
  const min = parseSignedAmerican(minAmerican);
  if (!Number.isFinite(min)) return players ?? [];
  const b = book === 'dk' ? 'dk' : 'fd';
  return (players ?? []).filter((row) => {
    const american = row[b]?.american ?? row.bestBook?.american;
    return american != null && american >= min;
  });
}

export function formatHedgeLegs(hedge) {
  if (!hedge?.legs?.length) return '—';
  return hedge.legs.map((leg) => {
    const book = bookShort(leg.book);
    return `${book} ${leg.label} ${formatAmericanOdds(leg.american)}`;
  }).join(' · ');
}

export { formatCombinedPct, formatJuicePct, formatAmericanOdds };
