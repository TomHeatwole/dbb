import { StartSitSort } from '../players/StartSitDecider';

/**
 * Apply league scoring_settings to a Sleeper projected stats object.
 * Every numeric scoring key is multiplied by the matching projected stat
 * when present; unknown / extra Sleeper fields are ignored.
 *
 * @param {Record<string, unknown>|null|undefined} stats
 * @param {Record<string, unknown>|null|undefined} scoringSettings
 * @returns {number|null}
 */
export function projectedPointsFromStats(stats, scoringSettings) {
  if (!stats || typeof stats !== 'object' || !scoringSettings || typeof scoringSettings !== 'object') {
    return null;
  }
  let total = 0;
  let matched = false;
  for (const [key, weight] of Object.entries(scoringSettings)) {
    const w = Number(weight);
    if (!Number.isFinite(w) || w === 0) {
      continue;
    }
    const raw = stats[key];
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(v)) {
      continue;
    }
    total += v * w;
    matched = true;
  }
  return matched ? total : 0;
}

/**
 * @param {Record<string, { stats?: Record<string, unknown> }>|null|undefined} byPlayerId
 * @param {Record<string, unknown>|null|undefined} scoringSettings
 * @returns {Record<string, number>}
 */
export function computeProjectedPointsMap(byPlayerId, scoringSettings) {
  const out = {};
  if (!byPlayerId || typeof byPlayerId !== 'object' || !scoringSettings) {
    return out;
  }
  for (const [playerId, rec] of Object.entries(byPlayerId)) {
    const pts = projectedPointsFromStats(rec && rec.stats, scoringSettings);
    if (typeof pts === 'number' && Number.isFinite(pts)) {
      out[String(playerId)] = pts;
    }
  }
  return out;
}

function labelForPlayer(playerGameLabels, playerId) {
  if (!playerGameLabels || playerId == null) {
    return null;
  }
  return playerGameLabels[playerId] || playerGameLabels[String(playerId)] || null;
}

function scoreIsLockedIn(label, actualPts) {
  if (label && (label.live || label.completed)) {
    return true;
  }
  if (label && label.text === 'BYE') {
    return true;
  }
  if (!label && typeof actualPts === 'number' && actualPts > 0) {
    return true;
  }
  return false;
}

function sourceForLocked(label) {
  if (label && label.live) {
    return 'live';
  }
  if (label && label.text === 'BYE') {
    return 'bye';
  }
  return 'actual';
}

function hybridPlayerRow(player, projectedPtsById, playerGameLabels) {
  if (!player || player.id == null || String(player.id) === '0') {
    return player;
  }
  const pid = String(player.id);
  const label = labelForPlayer(playerGameLabels, player.id);
  const actual = typeof player.pts === 'number' ? player.pts : 0;
  if (scoreIsLockedIn(label, actual)) {
    return { ...player, pts: actual, ptsSource: sourceForLocked(label) };
  }
  const proj = projectedPtsById ? projectedPtsById[pid] : undefined;
  if (typeof proj === 'number' && Number.isFinite(proj)) {
    return { ...player, pts: proj, ptsSource: 'proj' };
  }
  return { ...player, pts: actual, ptsSource: 'none' };
}

/**
 * Replace unplayed players' points with league-scored Sleeper projections.
 * Completed / live / BYE rows keep actual points.
 *
 * @param {object|null|undefined} teamScore
 * @param {Record<string, number>|null|undefined} projectedPtsById
 * @param {object|null|undefined} playerGameLabels
 */
export function applyHybridProjectedPoints(teamScore, projectedPtsById, playerGameLabels) {
  if (!teamScore) {
    return teamScore;
  }
  if (!projectedPtsById || Object.keys(projectedPtsById).length === 0) {
    return teamScore;
  }
  return {
    ...teamScore,
    starters: (teamScore.starters || []).map((p) => hybridPlayerRow(p, projectedPtsById, playerGameLabels)),
    bench: (teamScore.bench || []).map((p) => hybridPlayerRow(p, projectedPtsById, playerGameLabels)),
  };
}

function annotatePlayer(player, projectedPtsById, playerGameLabels) {
  if (!player || player.id == null || String(player.id) === '0') {
    return player;
  }
  const pid = String(player.id);
  const label = labelForPlayer(playerGameLabels, player.id);
  const actual = typeof player.pts === 'number' ? player.pts : 0;
  if (scoreIsLockedIn(label, actual)) {
    return { ...player, ptsSource: sourceForLocked(label) };
  }
  if (projectedPtsById && typeof projectedPtsById[pid] === 'number') {
    return { ...player, ptsSource: 'proj' };
  }
  return { ...player, ptsSource: 'none' };
}

/**
 * Re-attach ptsSource after StartSitSort (it only keeps id/pts).
 */
export function annotateProjectionSources(computed, playerGameLabels, projectedPtsById) {
  if (!computed) {
    return computed;
  }
  const starters = (computed.starters || []).map((p) => annotatePlayer(p, projectedPtsById, playerGameLabels));
  const bench = (computed.bench || []).map((p) => annotatePlayer(p, projectedPtsById, playerGameLabels));
  const includesProjection = starters.some((p) => p && p.ptsSource === 'proj');
  return { ...computed, starters, bench, includesProjection };
}

/**
 * Optimal lineup using actual points for finished/live games and
 * league-scored projections for everyone still unplayed.
 */
export function startSitWithProjections(
  teamScore,
  playersData,
  playerIdMap,
  playerGameLabels,
  injuriesMap,
  playerSeasonTotalsMap,
  projectedPtsById
) {
  const hybrid = applyHybridProjectedPoints(teamScore, projectedPtsById, playerGameLabels);
  const computed = StartSitSort(hybrid, playersData, playerIdMap, playerGameLabels, injuriesMap, playerSeasonTotalsMap);
  return annotateProjectionSources(computed, playerGameLabels, projectedPtsById);
}
