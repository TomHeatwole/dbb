/**
 * Compact per-game SOP snapshot: offered SOP vs the longest no-goal line.
 */

import {
  analyzeAgainstBreakeven,
  computeBreakevenOdds,
  formatAmericanOdds,
  NO_GOAL_SOURCE_KEYS,
} from './sopModel';
import { findLongestNoGoalPick, quoteForNoGoalBook } from './longestNoGoalPick';

const TEAM_SHORT = {
  'manchester united': 'Man Utd',
  'manchester city': 'Man City',
  'nottingham forest': "Nott'm",
  'nottm forest': "Nott'm",
  'nottm': "Nott'm",
  'tottenham hotspur': 'Spurs',
  'wolverhampton wanderers': 'Wolves',
  'brighton & hove albion': 'Brighton',
  'brighton and hove albion': 'Brighton',
  'west ham united': 'West Ham',
  'newcastle united': 'Newcastle',
  'crystal palace': 'Palace',
  'aston villa': 'Villa',
  'leeds united': 'Leeds',
  'afc bournemouth': 'Bournemouth',
};

export function shortTeamName(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  const mapped = TEAM_SHORT[raw.toLowerCase()];
  if (mapped) return mapped;
  const cleaned = raw.replace(/\b(AFC|FC)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 11) return cleaned;
  return cleaned.split(/[\s&/]+/).filter(Boolean)[0] || cleaned;
}

export function shortGameName(game) {
  const home = shortTeamName(game?.teams?.home);
  const away = shortTeamName(game?.teams?.away);
  if (home && away) return `${home} v ${away}`;
  const raw = String(game?.name ?? '').trim();
  if (!raw) return '—';
  return raw
    .split(/\s+v(?:s\.?)?\s+/i)
    .map((part) => shortTeamName(part))
    .join(' v ');
}

export function liveClockLabel(game) {
  const espn = game?.espn;
  if (!espn) return game?.inPlay ? 'LIVE' : null;
  if (espn.halfTime) return 'HT';
  if (espn.finished) return 'FT';
  if (espn.status !== 'in' && !game.inPlay) return null;
  if (espn.clock) return espn.clock;
  if (espn.period === 1) return '1H';
  if (espn.period === 2) return '2H';
  return espn.matchStatus || (game.inPlay ? 'LIVE' : null);
}

export function bookTag(book) {
  if (book === 'dk') return 'DK';
  if (book === 'klsh') return 'KLSH';
  return 'FD';
}

export function gameAnchorId(eventId) {
  return `live-game-${eventId}`;
}

function longestLinePickLabel(sourceKey, quote) {
  if (sourceKey === NO_GOAL_SOURCE_KEYS.correctScore && quote?.scoreUsed) {
    return quote.scoreUsed;
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.totalGoalsUnder && quote?.line != null) {
    return `U${quote.line}`;
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.nthGoalNeither) {
    if (quote?.goalNumber != null) return `G${quote.goalNumber}`;
    const selection = String(quote?.selection ?? '');
    if (selection && selection.length <= 8 && !/no goals|neither/i.test(selection)) {
      return selection;
    }
    return 'Nth';
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.nextGoalscorer) {
    return 'NGS';
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.nextGoalMethod) {
    return 'NG';
  }
  return quote?.selection ?? 'NG';
}

function bestSopOffer(game) {
  const fdAmerican = game?.goalTypes?.sop?.american ?? null;
  const dkAmerican = !game?.inPlay && Number.isFinite(game?.dk?.goalTypes?.sop?.american)
    ? game.dk.goalTypes.sop.american
    : null;

  const candidates = [];
  if (Number.isFinite(fdAmerican)) candidates.push({ book: 'fd', american: fdAmerican });
  if (Number.isFinite(dkAmerican)) candidates.push({ book: 'dk', american: dkAmerican });
  if (!candidates.length) return null;
  return candidates.reduce((best, cur) => (cur.american > best.american ? cur : best));
}

export function buildSopGameSnapshot(game) {
  const longest = findLongestNoGoalPick(game);
  const longestQuote = quoteForNoGoalBook(game, longest.sourceKey, longest.book);
  const longestAmerican = Number.isFinite(longestQuote?.american)
    ? longestQuote.american
    : (Number.isFinite(longest.american) ? longest.american : null);
  const model = Number.isFinite(longestAmerican) ? computeBreakevenOdds(longestAmerican) : null;
  const sopBe = model?.sop?.american ?? null;
  const offered = bestSopOffer(game);
  const analysis = offered && Number.isFinite(sopBe)
    ? analyzeAgainstBreakeven(offered.american, sopBe)
    : null;

  return {
    eventId: game?.eventId,
    name: shortGameName(game),
    fullName: game?.name ?? shortGameName(game),
    score: game?.scoreDisplay ?? '0-0',
    clock: liveClockLabel(game),
    inPlay: Boolean(game?.inPlay),
    market: 'SOP',
    oddsBook: offered?.book ?? null,
    oddsAmerican: offered?.american ?? null,
    lineLabel: Number.isFinite(longestAmerican)
      ? `${bookTag(longest.book)} ${longestLinePickLabel(longest.sourceKey, longestQuote)} ${formatAmericanOdds(longestAmerican)}`
      : '—',
    edgePoints: analysis?.edgePoints ?? null,
    profitable: Boolean(analysis?.profitable),
  };
}

const MONITOR_UPCOMING_MS = 18 * 60 * 60 * 1000;

export function isActiveMonitorGame(game, now = Date.now()) {
  if (game?.inPlay) return true;
  const kick = Date.parse(game?.openDate ?? '');
  if (!Number.isFinite(kick)) return false;
  return kick <= now + MONITOR_UPCOMING_MS;
}

export function buildSopMonitorRows(games, now = Date.now()) {
  return (games ?? [])
    .filter((game) => isActiveMonitorGame(game, now))
    .map((game) => buildSopGameSnapshot(game));
}
