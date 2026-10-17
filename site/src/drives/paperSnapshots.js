/**
 * /drives paper snapshots: pregame first-drive, halftime next-drive, and
 * in-play main-line (live spread + over/under) rows. No live drive-result
 * four-ways.
 */

import { americanToImpliedProb } from '../sop/sopModel.js';
import {
  DRIVE_BUCKETS,
  evaluateDriveGame,
  extractHomeSpread,
  extractOverUnder,
  isHalftimeLive,
  listDriveSides,
  nameMatchScore,
  pickBestLiveState,
} from './driveModel.js';

const BUCKETS = DRIVE_BUCKETS.map((row) => row.key);

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function pickSpreadRunners(game) {
  const runners = game?.lines?.spread?.runners ?? [];
  const home = game?.teams?.home;
  const away = game?.teams?.away;
  let bestHome = null;
  let bestHomeScore = 0;
  let bestAway = null;
  let bestAwayScore = 0;
  for (const runner of runners) {
    if (!Number.isFinite(runner.handicap)) continue;
    const homeScore = nameMatchScore(runner.runnerName, home);
    const awayScore = nameMatchScore(runner.runnerName, away);
    if (homeScore > awayScore && homeScore > bestHomeScore) {
      bestHomeScore = homeScore;
      bestHome = runner;
    }
    if (awayScore > homeScore && awayScore > bestAwayScore) {
      bestAwayScore = awayScore;
      bestAway = runner;
    }
  }
  return { home: bestHome, away: bestAway };
}

export function readDriveMainLines(game) {
  const spread = extractHomeSpread(game);
  const total = extractOverUnder(game);
  const { home, away } = pickSpreadRunners(game);
  const totalRunners = game?.lines?.total?.runners ?? [];
  const over = totalRunners.find((r) => /over/i.test(r.runnerName ?? ''));
  const under = totalRunners.find((r) => /under/i.test(r.runnerName ?? ''));
  return {
    home_spread: Number.isFinite(spread) ? spread : null,
    total: Number.isFinite(total) ? total : null,
    spread_home_american: finite(home?.american),
    spread_away_american: finite(away?.american),
    total_over_american: finite(over?.american),
    total_under_american: finite(under?.american),
  };
}

function hasMainLine(lines) {
  return lines?.home_spread != null || lines?.total != null;
}

function gameIsInPlay(game) {
  const view = pickBestLiveState(game);
  if (isHalftimeLive(view?.live)) return true;
  if (!view?.inPlay || view?.live?.state === 'pre') return false;
  return true;
}

function mainLineFields(game, pregame) {
  const view = pickBestLiveState(game);
  const lines = readDriveMainLines(game);
  return {
    ...lines,
    period: finite(view?.live?.period),
    clock: view?.live?.clock ?? null,
    pregame_spread: finite(pregame?.home_spread) ?? finite(pregame?.spread),
    pregame_total: finite(pregame?.total),
  };
}

export function drivesCapturePhase(game) {
  const view = pickBestLiveState(game);
  if (isHalftimeLive(view?.live)) return 'halftime_next';
  if (!view?.inPlay || view?.live?.state === 'pre') return 'pregame_first';
  return null;
}

function flattenBuckets(prefix, pack) {
  const out = {};
  for (const key of BUCKETS) {
    out[`${prefix}_${key}`] = pack?.[key] ?? null;
  }
  return out;
}

function oddsFingerprint(phase, offenseSide, score, fd, dk) {
  return JSON.stringify({
    phase,
    offenseSide,
    score,
    fd,
    dk,
  });
}

function liveLinesFingerprint(score, lines, period) {
  return JSON.stringify({
    phase: 'live_lines',
    spread: lines.home_spread,
    total: lines.total,
    spreadHomeAmerican: lines.spread_home_american,
    spreadAwayAmerican: lines.spread_away_american,
    totalOverAmerican: lines.total_over_american,
    totalUnderAmerican: lines.total_under_american,
    score,
    period: finite(period),
  });
}

export function buildDrivesPaperSnapshot(game, market, {
  capturedAt = new Date(),
  pregame = null,
} = {}) {
  const phase = drivesCapturePhase(game);
  if (!phase) return null;
  const eventId = game?.eventId != null ? String(game.eventId) : '';
  if (!eventId) return null;

  const model = evaluateDriveGame(game, { market, lineFilter: false, kellyEnabled: false });
  if (!model?.hasBook) return null;

  const fd = {};
  const dk = {};
  const modelP = {};
  const liveP = {};
  const fair = {};
  for (const row of model.rows ?? []) {
    fd[row.key] = finite(row.fdAmerican);
    dk[row.key] = finite(row.dkAmerican);
    modelP[row.key] = finite(row.p);
    liveP[row.key] = americanToImpliedProb(row.american);
    fair[row.key] = finite(row.fairAmerican);
  }
  if (!BUCKETS.some((key) => fd[key] != null || dk[key] != null)) return null;

  const score = {
    home: finite(game?.score?.home) ?? 0,
    away: finite(game?.score?.away) ?? 0,
  };
  const offenseSide = model.offenseSide === 'away' ? 'away' : 'home';
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const payload = {
    sport: 'drives',
    event_id: eventId,
    name: game?.name ?? null,
    home: game?.teams?.home ?? null,
    away: game?.teams?.away ?? null,
    kickoff_at: game?.openDate ?? null,
    espn_id: game?.espnId != null ? String(game.espnId) : null,
    phase,
    offense_side: offenseSide,
    offense_name: model.offenseName ?? null,
    drive_number: finite(model.driveNumber),
    market_name: model.marketName ?? null,
    score_home: score.home,
    score_away: score.away,
    ...flattenBuckets('fd', fd),
    ...flattenBuckets('dk', dk),
    ...flattenBuckets('model', fair),
    ...flattenBuckets('model_p', modelP),
    ...flattenBuckets('live_p', liveP),
    ...mainLineFields(game, pregame),
    captured_at: captured.toISOString(),
  };

  return {
    sport: 'drives',
    eventId,
    phase,
    offenseSide,
    capturedAt: captured,
    kickoffAt: game?.openDate ?? null,
    oddsFingerprint: oddsFingerprint(phase, offenseSide, score, fd, dk),
    payload,
  };
}

export function buildDrivesLiveLinesSnapshot(game, {
  capturedAt = new Date(),
  pregame = null,
} = {}) {
  if (!gameIsInPlay(game)) return null;
  const eventId = game?.eventId != null ? String(game.eventId) : '';
  if (!eventId) return null;
  const lines = readDriveMainLines(game);
  if (!hasMainLine(lines)) return null;

  const view = pickBestLiveState(game);
  const score = {
    home: finite(game?.score?.home) ?? 0,
    away: finite(game?.score?.away) ?? 0,
  };
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const payload = {
    sport: 'drives',
    event_id: eventId,
    name: game?.name ?? null,
    home: game?.teams?.home ?? null,
    away: game?.teams?.away ?? null,
    kickoff_at: game?.openDate ?? null,
    espn_id: game?.espnId != null ? String(game.espnId) : null,
    phase: 'live_lines',
    offense_side: null,
    offense_name: null,
    drive_number: null,
    market_name: 'Live spread / total',
    score_home: score.home,
    score_away: score.away,
    ...mainLineFields(game, pregame),
    captured_at: captured.toISOString(),
  };

  return {
    sport: 'drives',
    eventId,
    phase: 'live_lines',
    offenseSide: null,
    capturedAt: captured,
    kickoffAt: game?.openDate ?? null,
    oddsFingerprint: liveLinesFingerprint(score, lines, view?.live?.period),
    payload,
  };
}

export const DRIVES_CSV_COLUMNS = [
  'id', 'sport', 'odds_fingerprint',
  'captured_at', 'event_id', 'name', 'home', 'away', 'kickoff_at',
  'phase', 'offense_side', 'offense_name', 'drive_number', 'market_name',
  'score_home', 'score_away',
  'fd_td', 'fd_fg', 'fd_punt', 'fd_other',
  'dk_td', 'dk_fg', 'dk_punt', 'dk_other',
  'model_td', 'model_fg', 'model_punt', 'model_other',
  'model_p_td', 'model_p_fg', 'model_p_punt', 'model_p_other',
  'live_p_td', 'live_p_fg', 'live_p_punt', 'live_p_other',
  'home_spread', 'total',
  'spread_home_american', 'spread_away_american',
  'total_over_american', 'total_under_american',
  'period', 'clock',
  'pregame_spread', 'pregame_total',
  'espn_id', 'result', 'result_label', 'settled_at',
  'model_p_result', 'live_p_result', 'model_logloss', 'market_logloss',
  'result_spread', 'result_total', 'score_final_home', 'score_final_away',
];

export function collectDrivesPaperSnapshots(games, {
  capturedAt = new Date(),
  pregameByEvent = {},
} = {}) {
  const rows = [];
  for (const game of games ?? []) {
    const eventId = game?.eventId != null ? String(game.eventId) : '';
    const pregame = eventId ? pregameByEvent[eventId] ?? null : null;
    const phase = drivesCapturePhase(game);
    if (phase) {
      for (const market of listDriveSides(game)) {
        const row = buildDrivesPaperSnapshot(game, market, { capturedAt, pregame });
        if (row) rows.push(row);
      }
    }
    const liveLines = buildDrivesLiveLinesSnapshot(game, { capturedAt, pregame });
    if (liveLines) rows.push(liveLines);
  }
  return rows;
}
