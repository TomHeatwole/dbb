/**
 * Corners paper snapshots for /corners and /mlscorner.
 * New row when score, corners-so-far, 5-minute clock bin, or posted odds change.
 */

import { americanToImpliedProb } from '../sop/sopModel.js';
import {
  evaluateGameCorners,
  parseClockState,
  pickClosestPlus,
} from './cornerModel.mjs';
import { findLongestCornerBaseline } from './gameSnapshot.js';

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function scorePair(game) {
  const home = finite(game?.score?.home);
  const away = finite(game?.score?.away);
  if (home != null && away != null) return { home, away };
  const fromDisplay = String(game?.scoreDisplay ?? '').match(/^(\d+)\s*-\s*(\d+)$/);
  if (fromDisplay) return { home: Number(fromDisplay[1]), away: Number(fromDisplay[2]) };
  return { home: 0, away: 0 };
}

export function cornersClockBin(game) {
  const clock = parseClockState(game?.stoppage);
  if (!game?.inPlay || clock.phase === 'pre') return 'pregame';
  if (clock.phase === 'ht' || clock.halftime) return 'ht';
  if (clock.phase === 'post' || clock.finished) return 'ft';
  if (clock.inStoppage && (clock.elapsed >= 90 || clock.period === 2)) return '90+';
  if (clock.inStoppage && clock.period === 1) return '45+';
  const elapsed = Math.max(0, Number(clock.elapsed) || 0);
  const start = Math.floor(elapsed / 5) * 5;
  return `${start}-${start + 5}`;
}

export function cornersSituationKey(game) {
  const score = scorePair(game);
  const corners = finite(game?.cornersSoFar) ?? 0;
  const phase = game?.inPlay ? (cornersClockBin(game) === 'ht' ? 'ht' : 'live') : 'pregame';
  return `${phase}:${score.home}-${score.away}:${corners}c:${cornersClockBin(game)}`;
}

function ouBits(total) {
  if (!total) return { line: null, over: null, under: null };
  return {
    line: finite(total.line),
    over: finite(total.over?.american),
    under: finite(total.under?.american),
  };
}

function plusBits(row) {
  if (!row || !Number.isFinite(row.n)) return { n: null, yes: null, no: null };
  return {
    n: row.n,
    yes: finite(row.american),
    no: finite(row.noAmerican),
  };
}

function windowCompact(windowMarket) {
  if (!windowMarket) return [];
  const rows = [];
  for (const plus of windowMarket.plus ?? []) {
    if (!Number.isFinite(plus?.n) || plus.american == null) continue;
    rows.push({ kind: 'plus', n: plus.n, american: finite(plus.american) });
  }
  for (const ou of windowMarket.overUnder ?? []) {
    const american = finite(ou?.american) ?? finite(ou?.over?.american) ?? finite(ou?.under?.american);
    if (american == null || !Number.isFinite(ou?.line)) continue;
    rows.push({
      kind: 'ou',
      side: ou.side ?? (ou.over ? 'over' : 'under'),
      line: ou.line,
      american,
    });
  }
  return rows;
}

function betByKind(bets, kind, n = null) {
  return (bets ?? []).find((bet) => {
    if (bet?.kind !== kind) return false;
    if (n == null) return true;
    return Number(bet?.meta?.n) === n;
  }) ?? null;
}

function pregameFlat(pregame) {
  if (!pregame || typeof pregame !== 'object') return {};
  return {
    pregame_fd_total_line: pregame.fd_total_line ?? null,
    pregame_fd_over: pregame.fd_over ?? null,
    pregame_fd_under: pregame.fd_under ?? null,
    pregame_dk_total_line: pregame.dk_total_line ?? null,
    pregame_dk_over: pregame.dk_over ?? null,
    pregame_dk_under: pregame.dk_under ?? null,
    pregame_klsh_plus_n: pregame.klsh_plus_n ?? null,
    pregame_klsh_yes: pregame.klsh_yes ?? null,
    pregame_model_remaining: pregame.model_remaining ?? null,
    pregame_json: JSON.stringify({
      fd_total_line: pregame.fd_total_line ?? null,
      fd_over: pregame.fd_over ?? null,
      fd_under: pregame.fd_under ?? null,
      dk_total_line: pregame.dk_total_line ?? null,
      dk_over: pregame.dk_over ?? null,
      dk_under: pregame.dk_under ?? null,
      klsh_plus_n: pregame.klsh_plus_n ?? null,
      klsh_yes: pregame.klsh_yes ?? null,
      klsh_no: pregame.klsh_no ?? null,
      model_remaining: pregame.model_remaining ?? null,
      market_remaining: pregame.market_remaining ?? null,
    }),
  };
}

export function buildCornersPaperSnapshot(game, {
  league = 'pl',
  pregame = null,
  pregameByEvent = null,
  capturedAt = new Date(),
  bucketed = true,
} = {}) {
  const rawId = game?.eventId != null ? String(game.eventId) : '';
  if (!rawId) return null;
  const leagueKey = game?.competition === 'mls' || league === 'mls'
    ? 'mls'
    : (game?.competition === 'ucl' ? 'ucl' : 'pl');
  const eventId = `${leagueKey}:${rawId}`;
  const modelLeague = leagueKey === 'mls' ? 'mls' : 'pl';

  const fdTotal = ouBits(game?.total);
  const dkTotal = ouBits(game?.dk?.total ?? (game?.dk?.totals ?? [])[0]);
  const klshClosest = plusBits(pickClosestPlus(game?.klsh?.plus));
  const next5Odds = windowCompact(game?.next5);
  const next10Odds = windowCompact(game?.next10);
  const hasOdds = fdTotal.over != null || fdTotal.under != null
    || dkTotal.over != null || dkTotal.under != null
    || klshClosest.yes != null
    || next5Odds.length > 0 || next10Odds.length > 0;
  if (!hasOdds) return null;

  const clockBin = cornersClockBin(game);
  if (clockBin === 'ft') return null;
  const phase = !game?.inPlay ? 'pregame' : (clockBin === 'ht' ? 'ht' : 'live');
  const score = scorePair(game);
  const cornersSoFar = finite(game?.cornersSoFar) ?? 0;
  const situation = cornersSituationKey(game);
  const pregameRow = pregame
    ?? pregameByEvent?.[eventId]
    ?? null;
  const longest = findLongestCornerBaseline(game);
  const model = evaluateGameCorners(game, {
    bucketed,
    baselineBook: longest?.book ?? 'fd',
    league: modelLeague,
  });
  const next5_1 = betByKind(model.bets, 'next5-plus', 1);
  const next10_1 = betByKind(model.bets, 'next10-plus', 1);
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const payload = {
    sport: 'corners',
    league: leagueKey,
    event_id: eventId,
    name: game?.name ?? null,
    home: game?.teams?.home ?? null,
    away: game?.teams?.away ?? null,
    kickoff_at: game?.openDate ?? null,
    competition: game?.competition ?? leagueKey,
    phase,
    situation,
    clock_bin: clockBin,
    score_home: score.home,
    score_away: score.away,
    corners_so_far: cornersSoFar,
    clock: game?.stoppage?.clock ?? (phase === 'ht' ? 'HT' : (game?.inPlay ? 'LIVE' : null)),
    in_play: Boolean(game?.inPlay),
    baseline_book: longest?.book ?? null,
    baseline_line: finite(longest?.line) ?? finite(longest?.n) ?? null,
    fd_total_line: fdTotal.line,
    fd_over: fdTotal.over,
    fd_under: fdTotal.under,
    dk_total_line: dkTotal.line,
    dk_over: dkTotal.over,
    dk_under: dkTotal.under,
    klsh_plus_n: klshClosest.n,
    klsh_yes: klshClosest.yes,
    klsh_no: klshClosest.no,
    model_remaining: finite(model.ourRemaining),
    market_remaining: finite(model.marketRemaining),
    live_over_p: americanToImpliedProb(fdTotal.over ?? dkTotal.over),
    next5_1plus_american: finite(next5_1?.american),
    next5_1plus_model_p: finite(next5_1?.pModel),
    next5_1plus_live_p: finite(next5_1?.pMarket),
    next10_1plus_american: finite(next10_1?.american),
    next10_1plus_model_p: finite(next10_1?.pModel),
    next10_1plus_live_p: finite(next10_1?.pMarket),
    next5_json: JSON.stringify(next5Odds),
    next10_json: JSON.stringify(next10Odds),
    ...(phase === 'live' || phase === 'ht' ? pregameFlat(pregameRow) : {}),
    captured_at: captured.toISOString(),
  };

  return {
    sport: 'corners',
    eventId,
    phase,
    offenseSide: null,
    capturedAt: captured,
    kickoffAt: game?.openDate ?? null,
    oddsFingerprint: JSON.stringify({
      situation,
      fdTotal,
      dkTotal,
      klsh: klshClosest,
      next5Odds,
      next10Odds,
    }),
    payload,
  };
}

export function collectCornersPaperSnapshots(games, opts = {}) {
  const rows = [];
  for (const game of games ?? []) {
    const row = buildCornersPaperSnapshot(game, opts);
    if (row) rows.push(row);
  }
  return rows;
}

export const CORNERS_CSV_COLUMNS = [
  'id', 'sport', 'odds_fingerprint',
  'captured_at', 'league', 'event_id', 'name', 'home', 'away', 'kickoff_at',
  'competition', 'phase', 'situation', 'clock_bin',
  'score_home', 'score_away', 'corners_so_far', 'clock', 'in_play',
  'baseline_book', 'baseline_line',
  'fd_total_line', 'fd_over', 'fd_under',
  'dk_total_line', 'dk_over', 'dk_under',
  'klsh_plus_n', 'klsh_yes', 'klsh_no',
  'model_remaining', 'market_remaining', 'live_over_p',
  'next5_1plus_american', 'next5_1plus_model_p', 'next5_1plus_live_p',
  'next10_1plus_american', 'next10_1plus_model_p', 'next10_1plus_live_p',
  'next5_json', 'next10_json',
  'pregame_fd_total_line', 'pregame_fd_over', 'pregame_fd_under',
  'pregame_dk_total_line', 'pregame_dk_over', 'pregame_dk_under',
  'pregame_klsh_plus_n', 'pregame_klsh_yes', 'pregame_model_remaining',
  'pregame_json',
];
