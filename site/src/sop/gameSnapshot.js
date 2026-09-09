/**
 * Compact per-game SOP snapshot: best +EV goal type vs the longest no-goal line.
 */

import {
  analyzeAgainstBreakeven,
  computeBreakevenOdds,
  formatAmericanOdds,
  GOAL_TYPE_META,
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
  'paris saint germain': 'PSG',
  'paris st-germain': 'PSG',
  'paris st-g': 'PSG',
  'bayern munich': 'Bayern',
  'bayern munchen': 'Bayern',
  'atletico madrid': 'Atleti',
  'inter milan': 'Inter',
  internazionale: 'Inter',
  'borussia dortmund': 'Dortmund',
  'sporting lisbon': 'Sporting',
  'psv eindhoven': 'PSV',
  'shakhtar donetsk': 'Shakhtar',
  'slavia prague': 'Slavia',
  'club brugge': 'Brugge',
  'aek athens': 'AEK',
  'lask linz': 'LASK',
  'slovan bratislava': 'Slovan',
  'bodo glimt': 'Glimt',
  'real betis': 'Betis',
  'as roma': 'Roma',
  'rb leipzig': 'Leipzig',
  'fc sabah': 'Sabah',
  'sabah fk': 'Sabah',
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

function scoreGoalTypeOffer(offer, model) {
  const breakeven = model?.[offer.key]?.american ?? null;
  const analysis = Number.isFinite(breakeven)
    ? analyzeAgainstBreakeven(offer.american, breakeven)
    : null;
  return {
    ...offer,
    analysis,
    edgePoints: analysis?.edgePoints ?? null,
    profitable: Boolean(analysis?.profitable),
  };
}

/** Best +EV goal-type quote; SOP when nothing is profitable. */
export function pickHeadlineSopPlay(game, model) {
  const scored = collectGoalTypeOffers(game).map((offer) => scoreGoalTypeOffer(offer, model));
  if (!scored.length) return null;

  const profitable = scored.filter((offer) => offer.profitable && Number.isFinite(offer.edgePoints));
  if (profitable.length) {
    return profitable.reduce((best, cur) => (cur.edgePoints > best.edgePoints ? cur : best));
  }

  return scored.find((offer) => offer.key === 'sop') ?? scored[0];
}

export function buildSopGameSnapshot(game) {
  const longest = findLongestNoGoalPick(game);
  const longestQuote = quoteForNoGoalBook(game, longest.sourceKey, longest.book);
  const longestAmerican = Number.isFinite(longestQuote?.american)
    ? longestQuote.american
    : (Number.isFinite(longest.american) ? longest.american : null);
  const model = Number.isFinite(longestAmerican) ? computeBreakevenOdds(longestAmerican) : null;
  const play = pickHeadlineSopPlay(game, model);

  return {
    eventId: game?.eventId,
    name: shortGameName(game),
    fullName: game?.name ?? shortGameName(game),
    score: game?.scoreDisplay ?? '0-0',
    clock: liveClockLabel(game),
    inPlay: Boolean(game?.inPlay),
    competition: game?.competition ?? 'pl',
    market: play?.label ?? 'SOP',
    oddsBook: play?.book ?? null,
    oddsAmerican: play?.american ?? null,
    lineLabel: Number.isFinite(longestAmerican)
      ? `${bookTag(longest.book)} ${longestLinePickLabel(longest.sourceKey, longestQuote)} ${formatAmericanOdds(longestAmerican)}`
      : '—',
    edgePoints: play?.edgePoints ?? null,
    profitable: Boolean(play?.profitable),
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
