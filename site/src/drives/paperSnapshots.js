/**
 * /drives paper snapshots: pregame first-drive and halftime next-drive only.
 */

import { americanToImpliedProb } from '../sop/sopModel.js';
import { DRIVE_BUCKETS, evaluateDriveGame, isHalftimeLive, listDriveSides, pickBestLiveState } from './driveModel.js';

const BUCKETS = DRIVE_BUCKETS.map((row) => row.key);

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
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

export function buildDrivesPaperSnapshot(game, market, { capturedAt = new Date() } = {}) {
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
];

export function collectDrivesPaperSnapshots(games, { capturedAt = new Date() } = {}) {
  const rows = [];
  for (const game of games ?? []) {
    const phase = drivesCapturePhase(game);
    if (!phase) continue;
    for (const market of listDriveSides(game)) {
      const row = buildDrivesPaperSnapshot(game, market, { capturedAt });
      if (row) rows.push(row);
    }
  }
  return rows;
}
