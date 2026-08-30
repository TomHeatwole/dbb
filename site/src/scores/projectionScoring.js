import { StartSitSort, isEligibleForSlot } from '../players/StartSitDecider';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { SIMULATE_MIDWEEK, STARTER_POSITION_NAMES } from '../utils/global_constants';

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

function sourceForLocked(label) {
  if (label && label.live) {
    return 'live';
  }
  if (label && label.text === 'BYE') {
    return 'bye';
  }
  return 'actual';
}

function simulatedLockedPts(label, proj) {
  if (!SIMULATE_MIDWEEK || typeof proj !== 'number' || !Number.isFinite(proj)) {
    return null;
  }
  if (label && label.completed) {
    return proj;
  }
  if (label && label.live) {
    return Math.round(proj * 0.48 * 10) / 10;
  }
  return null;
}

function hybridPlayerRow(player, projectedPtsById, playerGameLabels) {
  if (!player || player.id == null || String(player.id) === '0') {
    return player;
  }
  const pid = String(player.id);
  const label = labelForPlayer(playerGameLabels, player.id);
  const proj = projectedPtsById ? projectedPtsById[pid] : undefined;
  const simulated = simulatedLockedPts(label, proj);
  const actual = simulated != null ? simulated : (typeof player.pts === 'number' ? player.pts : 0);
  if (label && (label.live || label.completed)) {
    return { ...player, pts: actual, ptsSource: sourceForLocked(label) };
  }
  if (label && label.text === 'BYE') {
    return { ...player, pts: 0, ptsSource: 'bye' };
  }
  return { ...player, pts: 0, ptsSource: 'unplayed' };
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

function remainingProj(actual, fullProj) {
  if (typeof fullProj !== 'number' || !Number.isFinite(fullProj)) {
    return 0;
  }
  return Math.max(0, roundTenth(fullProj - (Number(actual) || 0)));
}

function annotatePlayer(player, projectedPtsById, playerGameLabels) {
  if (!player || player.id == null || String(player.id) === '0') {
    return player;
  }
  const pid = String(player.id);
  const label = labelForPlayer(playerGameLabels, player.id);
  const rawPts = typeof player.pts === 'number' ? player.pts : 0;
  const fullProj = projectedPtsById && typeof projectedPtsById[pid] === 'number'
    ? projectedPtsById[pid]
    : null;
  const started = Boolean(label && (label.live || label.completed));
  const actualPts = started ? rawPts : null;
  let leftover = 0;
  if (started && label.live) {
    leftover = remainingProj(rawPts, fullProj);
  } else if (!started && fullProj != null && !(label && label.text === 'BYE')) {
    leftover = fullProj;
  }
  const currentExpected = started
    ? (label.completed ? rawPts : roundTenth(rawPts + leftover))
    : (fullProj != null ? fullProj : 0);
  const source = started
    ? sourceForLocked(label)
    : (label && label.text === 'BYE' ? 'bye' : (fullProj != null ? 'unplayed' : 'none'));
  return {
    ...player,
    pts: started ? rawPts : 0,
    ptsSource: source,
    actualPts,
    projPts: fullProj,
    projRemaining: leftover,
    currentExpected,
  };
}

function roundTenth(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export function splitPtsBySource(players) {
  let actual = 0;
  let proj = 0;
  let remaining = 0;
  let hasActual = false;
  let hasProj = false;
  for (const player of players || []) {
    if (!player || player.id == null || String(player.id) === '0') {
      continue;
    }
    if (typeof player.actualPts === 'number') {
      actual += player.actualPts;
      hasActual = true;
    }
    if (typeof player.projPts === 'number') {
      proj += player.projPts;
      hasProj = true;
    }
    const leftover = typeof player.projRemaining === 'number' ? player.projRemaining : 0;
    if (leftover > 0) {
      remaining += leftover;
    }
  }
  return {
    actual: roundTenth(actual),
    proj: roundTenth(proj),
    remaining: roundTenth(remaining),
    hasActual,
    hasProj,
  };
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
  const starterSplit = splitPtsBySource(starters);
  const benchSplit = splitPtsBySource(bench);
  return {
    ...computed,
    starters,
    bench,
    includesProjection: starterSplit.hasProj,
    starterActualTotal: starterSplit.actual,
    starterProjTotal: starterSplit.proj,
    starterProjRemaining: starterSplit.remaining,
    starterHasActual: starterSplit.hasActual,
    starterTotal: roundTenth(starterSplit.actual + starterSplit.remaining),
    benchActualTotal: benchSplit.actual,
    benchProjTotal: benchSplit.proj,
    benchProjRemaining: benchSplit.remaining,
    benchHasActual: benchSplit.hasActual,
    benchHasProj: benchSplit.hasProj,
    benchTotal: roundTenth(benchSplit.actual + benchSplit.proj),
  };
}

function gameIsFinished(player) {
  return Boolean(player && (player.ptsSource === 'actual' || player.ptsSource === 'bye'));
}

/**
 * Value used to fill a slot when ranking by highest remaining projections.
 * Finished games lock at actual score. Live / unplayed use max(score, week proj).
 */
export function projectionSlotValue(player) {
  if (!player || player.id == null || String(player.id) === '0') {
    return 0;
  }
  if (gameIsFinished(player)) {
    return typeof player.actualPts === 'number' ? player.actualPts : (Number(player.pts) || 0);
  }
  const score = typeof player.actualPts === 'number' ? player.actualPts : 0;
  const proj = typeof player.projPts === 'number' ? player.projPts : 0;
  return Math.max(score, proj);
}

export function rankPtsForMode(player, mode) {
  if (mode === 'projections') {
    return projectionSlotValue(player);
  }
  return typeof player.currentExpected === 'number' ? player.currentExpected : (player.pts || 0);
}

function attachSortKeys(teamScore, mode) {
  const mapPlayer = (player) => {
    if (!player || player.id == null || String(player.id) === '0') {
      return player;
    }
    return {
      ...player,
      sortPts: rankPtsForMode(player, mode),
      keepPts: typeof player.actualPts === 'number' ? player.actualPts : 0,
    };
  };
  return {
    ...teamScore,
    starters: (teamScore.starters || []).map(mapPlayer),
    bench: (teamScore.bench || []).map(mapPlayer),
  };
}

function attachBenchProjHints(computed, playersData, playerIdMap, lineupMode) {
  if (!computed) {
    return computed;
  }
  const withPos = (player) => {
    if (!player || player.id == null || String(player.id) === '0') {
      return player;
    }
    const info = getPlayerInfo(player.id, playersData, playerIdMap);
    return { ...player, position: info && info.position ? info.position : null };
  };
  const bench = (computed.bench || []).map(withPos);
  const starters = (computed.starters || []).map((player, index) => {
    const starter = withPos(player);
    const slot = STARTER_POSITION_NAMES[index];
    if (!starter || starter.id == null || String(starter.id) === '0') {
      return starter;
    }
    const starterRank = rankPtsForMode(starter, lineupMode);
    let best = null;
    let bestRank = 0;
    for (const benchPlayer of bench) {
      if (!isEligibleForSlot(slot, benchPlayer.position)) {
        continue;
      }
      const expected = rankPtsForMode(benchPlayer, lineupMode);
      if (expected > starterRank + 0.049 && (!best || expected > bestRank)) {
        best = benchPlayer;
        bestRank = expected;
      }
    }
    if (!best) {
      return starter;
    }
    const info = getPlayerInfo(best.id, playersData, playerIdMap);
    return {
      ...starter,
      higherBenchProj: {
        id: best.id,
        name: info && info.name ? info.name : String(best.id),
        expected: bestRank,
      },
    };
  });
  return { ...computed, starters, bench };
}

function sortLineup(annotated, playersData, playerIdMap, playerGameLabels, injuriesMap, playerSeasonTotalsMap, mode) {
  return StartSitSort(
    attachSortKeys(annotated, mode),
    playersData,
    playerIdMap,
    playerGameLabels,
    injuriesMap,
    playerSeasonTotalsMap,
    { preferStarted: mode !== 'projections' }
  );
}

/**
 * Lineup for Scores.
 * lineupMode 'scores' (default): games that have started stay in the lineup.
 * lineupMode 'projections': rank by ceiling max(score, proj), finished games locked at actual.
 * Header Proj is always the projections-optimal total, independent of the displayed starters.
 */
export function startSitWithProjections(
  teamScore,
  playersData,
  playerIdMap,
  playerGameLabels,
  injuriesMap,
  playerSeasonTotalsMap,
  projectedPtsById,
  lineupMode = 'scores'
) {
  const mode = lineupMode === 'projections' ? 'projections' : 'scores';
  const hybrid = applyHybridProjectedPoints(teamScore, projectedPtsById, playerGameLabels);
  const annotated = annotateProjectionSources(hybrid, playerGameLabels, projectedPtsById);
  const projSorted = sortLineup(
    annotated,
    playersData,
    playerIdMap,
    playerGameLabels,
    injuriesMap,
    playerSeasonTotalsMap,
    'projections'
  );
  const projFinalized = annotateProjectionSources(projSorted, playerGameLabels, projectedPtsById);
  const optimalProjTotal = roundTenth(
    (projFinalized.starters || []).reduce((sum, player) => sum + projectionSlotValue(player), 0)
  );
  const displaySorted = mode === 'projections'
    ? projSorted
    : sortLineup(
      annotated,
      playersData,
      playerIdMap,
      playerGameLabels,
      injuriesMap,
      playerSeasonTotalsMap,
      'scores'
    );
  const finalized = mode === 'projections'
    ? projFinalized
    : annotateProjectionSources(displaySorted, playerGameLabels, projectedPtsById);
  const withHints = attachBenchProjHints(finalized, playersData, playerIdMap, mode);
  return {
    ...withHints,
    lineupMode: mode,
    optimalProjTotal,
  };
}
