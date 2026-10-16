/**
 * SOP2 paper snapshots: one row per game when score or posted odds change.
 * Clock ticks do not create a new row.
 */

import { americanToImpliedProb, computeBreakevenOdds, GOAL_TYPE_META, NO_GOAL_SOURCE_KEYS } from './sopModel.js';
import { findLongestNoGoalPick, quoteForNoGoalBook } from './longestNoGoalPick.js';
import { liveClockLabel, scoredGoalCount } from './gameSnapshot.js';

export const SOP_NO_GOAL_KEYS = [
  NO_GOAL_SOURCE_KEYS.nextGoalMethod,
  NO_GOAL_SOURCE_KEYS.correctScore,
  NO_GOAL_SOURCE_KEYS.totalGoalsUnder,
  NO_GOAL_SOURCE_KEYS.nthGoalNeither,
  NO_GOAL_SOURCE_KEYS.nextGoalscorer,
];

const GOAL_KEYS = GOAL_TYPE_META.map((row) => row.key);

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function quoteBits(quote) {
  if (!quote || typeof quote !== 'object') {
    return { american: null, line: null, selection: null, scoreUsed: null, goalNumber: null };
  }
  return {
    american: finite(quote.american),
    line: quote.line ?? null,
    selection: quote.selection ?? null,
    scoreUsed: quote.scoreUsed ?? null,
    goalNumber: finite(quote.goalNumber),
  };
}

function goalAmerican(game, key, book) {
  const pack = book === 'dk' ? game?.dk?.goalTypes : game?.goalTypes;
  return finite(pack?.[key]?.american);
}

function collectNoGoalBook(game, book) {
  const out = {};
  for (const key of SOP_NO_GOAL_KEYS) {
    out[key] = quoteBits(quoteForNoGoalBook(game, key, book));
  }
  return out;
}

function collectGoalBooks(game) {
  const fd = {};
  const dk = {};
  for (const key of GOAL_KEYS) {
    fd[key] = goalAmerican(game, key, 'fd');
    dk[key] = goalAmerican(game, key, 'dk');
  }
  return { fd, dk };
}

function scorePair(game) {
  const home = finite(game?.score?.home);
  const away = finite(game?.score?.away);
  if (home != null && away != null) return { home, away };
  const fromDisplay = String(game?.scoreDisplay ?? '').match(/^(\d+)\s*-\s*(\d+)$/);
  if (fromDisplay) return { home: Number(fromDisplay[1]), away: Number(fromDisplay[2]) };
  return { home: home ?? 0, away: away ?? 0 };
}

export function sopSituationKey(game) {
  const score = scorePair(game);
  const phase = game?.inPlay ? 'live' : 'pregame';
  return `${phase}:${score.home}-${score.away}`;
}

function oddsFingerprint(noGoal, goals) {
  const ng = {};
  for (const book of ['fd', 'dk', 'klsh']) {
    ng[book] = {};
    for (const key of SOP_NO_GOAL_KEYS) {
      ng[book][key] = noGoal[book]?.[key]?.american ?? null;
    }
  }
  return JSON.stringify({
    situation: noGoal.situation,
    noGoal: ng,
    goals,
  });
}

function modelAndLiveProbs(longestAmerican, goals) {
  const model = Number.isFinite(longestAmerican) ? computeBreakevenOdds(longestAmerican) : null;
  const modelGoalP = finite(model?.goalProb) ?? null;
  const modelNoGoalP = finite(model?.noGoalProb) ?? null;
  const liveNoGoalP = americanToImpliedProb(longestAmerican);
  const modelP = {};
  const liveP = {};
  for (const key of GOAL_KEYS) {
    modelP[key] = finite(model?.[key]?.implied) != null ? model[key].implied / 100 : null;
    const offered = goals.fd[key] ?? goals.dk[key];
    liveP[key] = americanToImpliedProb(offered);
  }
  return {
    modelNoGoalP,
    modelGoalP,
    liveNoGoalP: finite(liveNoGoalP),
    liveGoalP: finite(liveNoGoalP) != null ? 1 - liveNoGoalP : null,
    modelP,
    liveP,
  };
}

function flattenNoGoal(prefix, pack) {
  const out = {};
  for (const key of SOP_NO_GOAL_KEYS) {
    out[`${prefix}_${key}`] = pack?.[key]?.american ?? null;
  }
  return out;
}

function flattenGoals(prefix, pack) {
  const out = {};
  for (const key of GOAL_KEYS) {
    out[`${prefix}_${key}`] = pack?.[key] ?? null;
  }
  return out;
}

function flattenProbs(prefix, pack) {
  const out = {};
  for (const key of GOAL_KEYS) {
    out[`${prefix}_${key}_p`] = pack?.[key] ?? null;
  }
  return out;
}

function longestLabel(game, pick) {
  const quote = quoteForNoGoalBook(game, pick.sourceKey, pick.book);
  if (!quote) return null;
  if (pick.sourceKey === NO_GOAL_SOURCE_KEYS.correctScore && quote.scoreUsed) return quote.scoreUsed;
  if (pick.sourceKey === NO_GOAL_SOURCE_KEYS.totalGoalsUnder && quote.line != null) return `U ${quote.line}`;
  return quote.selection ?? null;
}

function pregameFlat(pregame) {
  if (!pregame || typeof pregame !== 'object') return {};
  return {
    pregame_longest_ng_book: pregame.longest_ng_book ?? null,
    pregame_longest_ng_source: pregame.longest_ng_source ?? null,
    pregame_longest_ng_american: pregame.longest_ng_american ?? null,
    pregame_model_goal_p: pregame.model_goal_p ?? null,
    pregame_model_no_goal_p: pregame.model_no_goal_p ?? null,
    pregame_fd_ng_totalGoalsUnder: pregame.fd_ng_totalGoalsUnder ?? null,
    pregame_fd_ng_nextGoalMethod: pregame.fd_ng_nextGoalMethod ?? null,
    pregame_fd_ng_correctScore: pregame.fd_ng_correctScore ?? null,
    pregame_fd_sop: pregame.fd_sop ?? null,
    pregame_fd_header: pregame.fd_header ?? null,
    pregame_json: JSON.stringify({
      longest_ng_book: pregame.longest_ng_book ?? null,
      longest_ng_source: pregame.longest_ng_source ?? null,
      longest_ng_american: pregame.longest_ng_american ?? null,
      fd_ng_nextGoalMethod: pregame.fd_ng_nextGoalMethod ?? null,
      fd_ng_correctScore: pregame.fd_ng_correctScore ?? null,
      fd_ng_totalGoalsUnder: pregame.fd_ng_totalGoalsUnder ?? null,
      fd_ng_nthGoalNeither: pregame.fd_ng_nthGoalNeither ?? null,
      fd_ng_nextGoalscorer: pregame.fd_ng_nextGoalscorer ?? null,
      dk_ng_nextGoalMethod: pregame.dk_ng_nextGoalMethod ?? null,
      dk_ng_correctScore: pregame.dk_ng_correctScore ?? null,
      dk_ng_totalGoalsUnder: pregame.dk_ng_totalGoalsUnder ?? null,
      dk_ng_nthGoalNeither: pregame.dk_ng_nthGoalNeither ?? null,
      dk_ng_nextGoalscorer: pregame.dk_ng_nextGoalscorer ?? null,
      klsh_ng_nextGoalMethod: pregame.klsh_ng_nextGoalMethod ?? null,
      klsh_ng_correctScore: pregame.klsh_ng_correctScore ?? null,
      klsh_ng_totalGoalsUnder: pregame.klsh_ng_totalGoalsUnder ?? null,
      fd_sop: pregame.fd_sop ?? null,
      fd_header: pregame.fd_header ?? null,
      fd_pk: pregame.fd_pk ?? null,
      fd_fk: pregame.fd_fk ?? null,
      fd_og: pregame.fd_og ?? null,
      dk_sop: pregame.dk_sop ?? null,
      dk_header: pregame.dk_header ?? null,
      dk_pk: pregame.dk_pk ?? null,
      dk_fk: pregame.dk_fk ?? null,
      dk_og: pregame.dk_og ?? null,
    }),
  };
}

export function buildSopPaperSnapshot(game, { pregame = null, capturedAt = new Date() } = {}) {
  const eventId = game?.eventId != null ? String(game.eventId) : '';
  if (!eventId) return null;

  const score = scorePair(game);
  const phase = game?.inPlay ? 'live' : 'pregame';
  const situation = sopSituationKey(game);
  const noGoal = {
    situation,
    fd: collectNoGoalBook(game, 'fd'),
    dk: collectNoGoalBook(game, 'dk'),
    klsh: collectNoGoalBook(game, 'klsh'),
  };
  const goals = collectGoalBooks(game);
  const hasOdds = SOP_NO_GOAL_KEYS.some((key) => (
    noGoal.fd[key].american != null
    || noGoal.dk[key].american != null
    || noGoal.klsh[key].american != null
  )) || GOAL_KEYS.some((key) => goals.fd[key] != null || goals.dk[key] != null);
  if (!hasOdds) return null;

  const longest = findLongestNoGoalPick(game);
  const probs = modelAndLiveProbs(longest.american, goals);
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const payload = {
    sport: 'sop',
    event_id: eventId,
    name: game?.name ?? null,
    home: game?.teams?.home ?? null,
    away: game?.teams?.away ?? null,
    kickoff_at: game?.openDate ?? null,
    competition: game?.competition ?? null,
    competition_name: game?.competitionName ?? null,
    phase,
    situation,
    score_home: score.home,
    score_away: score.away,
    next_goal_n: scoredGoalCount(game) + 1,
    clock: liveClockLabel(game),
    in_play: Boolean(game?.inPlay),
    longest_ng_book: Number.isFinite(longest.american) ? longest.book : null,
    longest_ng_source: Number.isFinite(longest.american) ? longest.sourceKey : null,
    longest_ng_american: Number.isFinite(longest.american) ? longest.american : null,
    longest_ng_label: Number.isFinite(longest.american) ? longestLabel(game, longest) : null,
    model_no_goal_p: probs.modelNoGoalP,
    model_goal_p: probs.modelGoalP,
    live_no_goal_p: probs.liveNoGoalP,
    live_goal_p: probs.liveGoalP,
    ...flattenNoGoal('fd_ng', noGoal.fd),
    ...flattenNoGoal('dk_ng', noGoal.dk),
    ...flattenNoGoal('klsh_ng', noGoal.klsh),
    ...flattenGoals('fd', goals.fd),
    ...flattenGoals('dk', goals.dk),
    ...flattenProbs('model', probs.modelP),
    ...flattenProbs('live', probs.liveP),
    ...(phase === 'live' ? pregameFlat(pregame) : {}),
    captured_at: captured.toISOString(),
  };

  return {
    sport: 'sop',
    eventId,
    phase,
    offenseSide: null,
    capturedAt: captured,
    kickoffAt: game?.openDate ?? null,
    oddsFingerprint: oddsFingerprint(noGoal, goals),
    payload,
  };
}

export const SOP_CSV_COLUMNS = [
  'id', 'sport', 'odds_fingerprint',
  'captured_at', 'event_id', 'name', 'home', 'away', 'kickoff_at',
  'competition', 'competition_name', 'phase', 'situation',
  'score_home', 'score_away', 'next_goal_n', 'clock', 'in_play',
  'longest_ng_book', 'longest_ng_source', 'longest_ng_american', 'longest_ng_label',
  'model_no_goal_p', 'model_goal_p', 'live_no_goal_p', 'live_goal_p',
  'fd_ng_nextGoalMethod', 'fd_ng_correctScore', 'fd_ng_totalGoalsUnder',
  'fd_ng_nthGoalNeither', 'fd_ng_nextGoalscorer',
  'dk_ng_nextGoalMethod', 'dk_ng_correctScore', 'dk_ng_totalGoalsUnder',
  'dk_ng_nthGoalNeither', 'dk_ng_nextGoalscorer',
  'klsh_ng_nextGoalMethod', 'klsh_ng_correctScore', 'klsh_ng_totalGoalsUnder',
  'klsh_ng_nthGoalNeither', 'klsh_ng_nextGoalscorer',
  'fd_sop', 'fd_header', 'fd_pk', 'fd_fk', 'fd_og',
  'dk_sop', 'dk_header', 'dk_pk', 'dk_fk', 'dk_og',
  'model_sop_p', 'model_header_p', 'model_pk_p', 'model_fk_p', 'model_og_p',
  'live_sop_p', 'live_header_p', 'live_pk_p', 'live_fk_p', 'live_og_p',
  'pregame_longest_ng_book', 'pregame_longest_ng_source', 'pregame_longest_ng_american',
  'pregame_model_goal_p', 'pregame_model_no_goal_p',
  'pregame_fd_ng_totalGoalsUnder', 'pregame_fd_ng_nextGoalMethod', 'pregame_fd_ng_correctScore',
  'pregame_fd_sop', 'pregame_fd_header', 'pregame_json',
];

export function collectSopPaperSnapshots(games, { pregameByEvent = {}, capturedAt = new Date() } = {}) {
  const rows = [];
  for (const game of games ?? []) {
    const pregame = game?.inPlay ? pregameByEvent[String(game.eventId)] ?? null : null;
    const row = buildSopPaperSnapshot(game, { pregame, capturedAt });
    if (row) rows.push(row);
  }
  return rows;
}
