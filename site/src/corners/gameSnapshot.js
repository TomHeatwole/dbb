/**
 * Compact per-game corners snapshot: best window play vs the longest total line.
 */

import { bookTag, isActiveMonitorGame, shortGameName } from '../sop/gameSnapshot';
import {
  evaluateGameCorners,
  formatAmericanOdds,
  listCornerBaselines,
} from './cornerModel';

function formatCornersScore(game) {
  const score = game?.scoreDisplay ?? '0-0';
  const corners = game?.cornersSoFar;
  if (!Number.isFinite(corners) || (!game?.inPlay && corners <= 0)) return score;
  return `${score} · ${corners}c`;
}

function cornersClockLabel(game) {
  const stoppage = game?.stoppage;
  if (stoppage?.finished) return 'FT';
  if (stoppage?.halfTime) return 'HT';
  if (stoppage?.clock) return stoppage.clock;
  if (game?.inPlay) return 'LIVE';
  return null;
}

function baselineLineNumber(row) {
  if (Number.isFinite(row?.line)) return row.line;
  if (Number.isFinite(row?.n)) return row.n - 0.5;
  return null;
}

function baselineRemaining(row) {
  if (row?.implied?.alreadyOver) return -1;
  return Number.isFinite(row?.implied?.remaining) ? row.implied.remaining : -1;
}

/** Highest posted total / plus line across FD, DK, and Kalshi. */
export function findLongestCornerBaseline(game) {
  const rows = listCornerBaselines(game);
  if (!rows.length) return null;

  return rows.reduce((best, row) => {
    const rowLine = baselineLineNumber(row);
    const bestLine = baselineLineNumber(best);
    if (Number.isFinite(rowLine) && Number.isFinite(bestLine) && rowLine !== bestLine) {
      return rowLine > bestLine ? row : best;
    }
    const rowRem = baselineRemaining(row);
    const bestRem = baselineRemaining(best);
    if (rowRem !== bestRem) return rowRem > bestRem ? row : best;
    return best;
  });
}

function baselineLabel(row) {
  if (!row) return '—';
  const tag = bookTag(row.book);
  if (row.kind === 'plus') {
    const odds = Number.isFinite(row.american) ? ` ${formatAmericanOdds(row.american)}` : '';
    return `${tag} ${row.n}+${odds}`;
  }
  const over = Number.isFinite(row.over?.american) ? formatAmericanOdds(row.over.american) : '—';
  return `${tag} ${row.line} ${over}`;
}

function playLabel(bet) {
  if (!bet) return '—';
  if (bet.kind?.startsWith('next5')) return `5′ ${bet.label}`;
  if (bet.kind?.startsWith('next10')) return `10′ ${bet.label}`;
  if (bet.kind === 'dk-both-yes') return 'DK both Y';
  if (bet.kind === 'dk-both-no') return 'DK both N';
  return bet.label ?? '—';
}

export function pickHeadlineCornerPlay(model) {
  const candidates = (model?.bets ?? []).filter((bet) => (
    !bet.baseline
    && Number.isFinite(bet.american)
    && Number.isFinite(bet.analysis?.edgePoints)
  ));
  if (!candidates.length) return null;
  return candidates.reduce((best, cur) => (
    cur.analysis.edgePoints > best.analysis.edgePoints ? cur : best
  ));
}

export function buildCornersGameSnapshot(game, { bucketed = true } = {}) {
  const longest = findLongestCornerBaseline(game);
  const model = evaluateGameCorners(game, {
    bucketed,
    baselineBook: longest?.book ?? 'fd',
  });
  const play = pickHeadlineCornerPlay(model);

  return {
    eventId: game?.eventId,
    name: shortGameName(game),
    fullName: game?.name ?? shortGameName(game),
    score: formatCornersScore(game),
    clock: cornersClockLabel(game),
    inPlay: Boolean(game?.inPlay),
    market: playLabel(play),
    oddsBook: play?.meta?.book ?? (play ? 'fd' : null),
    oddsAmerican: play?.american ?? null,
    lineLabel: baselineLabel(longest),
    edgePoints: play?.analysis?.edgePoints ?? null,
    profitable: Boolean(play?.profitable),
  };
}

export function buildCornersMonitorRows(games, { bucketed = true, now = Date.now() } = {}) {
  return (games ?? [])
    .filter((game) => isActiveMonitorGame(game, now))
    .map((game) => buildCornersGameSnapshot(game, { bucketed }));
}
