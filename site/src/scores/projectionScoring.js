import { StartSitSort, isEligibleForSlot } from '../players/StartSitDecider';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import {
  displayActualPts,
  espnLiveProjection,
  espnRemainingProj,
  liveTimeFrac,
  playerIsRuledOut,
} from './liveOutlook';

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

function hybridPlayerRow(player, projectedPtsById, playerGameLabels) {
  if (!player || player.id == null || String(player.id) === '0') {
    return player;
  }
  const pid = String(player.id);
  const label = labelForPlayer(playerGameLabels, player.id);
  const proj = projectedPtsById ? projectedPtsById[pid] : undefined;
  const actual = displayActualPts(player, label, proj);
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

function annotatePlayer(player, projectedPtsById, playerGameLabels, injuriesCtx) {
  if (!player || player.id == null || String(player.id) === '0') {
    return player;
  }
  const pid = String(player.id);
  const label = labelForPlayer(playerGameLabels, player.id);
  const fullProj = projectedPtsById && typeof projectedPtsById[pid] === 'number'
    ? projectedPtsById[pid]
    : null;
  const ruledOut = Boolean(
    injuriesCtx && playerIsRuledOut(
      player.id,
      injuriesCtx.injuriesMap,
      injuriesCtx.playersData,
      injuriesCtx.playerIdMap,
    ),
  );
  const finished = Boolean((label && label.completed) || ruledOut);
  const live = Boolean(label && label.live && !ruledOut);
  const started = finished || live;
  const rawPts = displayActualPts(player, label, fullProj);
  const actualPts = started ? rawPts : null;
  let leftover = 0;
  if (live) {
    leftover = espnRemainingProj(fullProj, liveTimeFrac(label));
  } else if (!started && fullProj != null && !(label && label.text === 'BYE')) {
    leftover = fullProj;
  }
  const currentExpected = finished
    ? rawPts
    : (live
      ? espnLiveProjection(rawPts, fullProj, liveTimeFrac(label))
      : (fullProj != null ? fullProj : 0));
  const source = finished
    ? (ruledOut && !(label && label.completed) ? 'actual' : sourceForLocked(label))
    : (live
      ? 'live'
      : (label && label.text === 'BYE' ? 'bye' : (fullProj != null ? 'unplayed' : 'none')));
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
export function annotateProjectionSources(computed, playerGameLabels, projectedPtsById, injuriesCtx = null) {
  if (!computed) {
    return computed;
  }
  const starters = (computed.starters || []).map((p) => annotatePlayer(p, projectedPtsById, playerGameLabels, injuriesCtx));
  const bench = (computed.bench || []).map((p) => annotatePlayer(p, projectedPtsById, playerGameLabels, injuriesCtx));
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
  if (typeof player.currentExpected === 'number' && Number.isFinite(player.currentExpected)) {
    return player.currentExpected;
  }
  const score = typeof player.actualPts === 'number' ? player.actualPts : 0;
  const proj = typeof player.projPts === 'number' ? player.projPts : 0;
  return Math.max(score, proj);
}

function remainingOutlook(player) {
  if (typeof player.projRemaining === 'number' && Number.isFinite(player.projRemaining)) {
    return player.projRemaining;
  }
  return 0;
}

export function rankPtsForMode(player, mode) {
  if (mode === 'projections') {
    return projectionSlotValue(player);
  }
  if (mode === 'remaining') {
    return remainingOutlook(player);
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

function actualScore(player) {
  return typeof player.actualPts === 'number' ? player.actualPts : 0;
}

function playerKey(player) {
  return player && player.id != null ? String(player.id) : null;
}

function isRealPlayer(player) {
  const id = playerKey(player);
  return Boolean(id && id !== '0');
}

function hintName(player, playersData, playerIdMap) {
  const info = getPlayerInfo(player.id, playersData, playerIdMap);
  return info && info.name ? info.name : String(player.id);
}

function attachScoreSoFarHints(starters, bench, playersData, playerIdMap) {
  const usedFloorIds = new Set();
  return starters.map((starter, index) => {
    if (!isRealPlayer(starter)) {
      return starter;
    }
    const slot = STARTER_POSITION_NAMES[index];
    const starterRank = actualScore(starter);
    let best = null;
    let bestRank = 0;
    for (const benchPlayer of bench) {
      if (!isRealPlayer(benchPlayer) || typeof benchPlayer.actualPts !== 'number') {
        continue;
      }
      if (usedFloorIds.has(playerKey(benchPlayer))) {
        continue;
      }
      if (!isEligibleForSlot(slot, benchPlayer.position)) {
        continue;
      }
      const pts = actualScore(benchPlayer);
      if (pts > starterRank + 0.049 && (!best || pts > bestRank)) {
        best = benchPlayer;
        bestRank = pts;
      }
    }
    if (!best) {
      return starter;
    }
    usedFloorIds.add(playerKey(best));
    return {
      ...starter,
      bestBenchScore: { id: best.id, name: hintName(best, playersData, playerIdMap), pts: bestRank },
    };
  });
}

function weekProj(player) {
  if (typeof player.projPts === 'number' && Number.isFinite(player.projPts)) {
    return player.projPts;
  }
  return remainingOutlook(player);
}

/**
 * Overlay leftover week-projections onto the scores seating.
 * Walk slots in order and consume the best unused bench proj that still
 * beats that seat. If the starter has already outscored it, the proj
 * slides to a later eligible slot (Lamar past Maye → Stafford SUPER).
 */
function attachBestballProjHints(displayStarters, benchPlayers, playersData, playerIdMap) {
  const used = new Set();

  function floor(starter) {
    // Finished games have no leftover projection — only the actual can block a slide.
    if (gameIsFinished(starter)) {
      return actualScore(starter);
    }
    return Math.max(actualScore(starter), weekProj(starter), projectionSlotValue(starter));
  }

  return (displayStarters || []).map((starter, index) => {
    if (!isRealPlayer(starter)) {
      return starter;
    }
    const slot = STARTER_POSITION_NAMES[index];
    let pick = null;
    let pickVal = -Infinity;
    for (const cand of benchPlayers) {
      const candKey = playerKey(cand);
      if (!candKey || used.has(candKey) || !isEligibleForSlot(slot, cand.position)) {
        continue;
      }
      if (gameIsFinished(cand)) {
        continue;
      }
      const val = weekProj(cand);
      if (val <= floor(starter) + 0.049) {
        continue;
      }
      if (val > pickVal) {
        pick = cand;
        pickVal = val;
      }
    }
    if (!pick) {
      return starter;
    }
    used.add(playerKey(pick));
    return {
      ...starter,
      higherBenchProj: {
        id: pick.id,
        name: hintName(pick, playersData, playerIdMap),
        expected: pickVal,
      },
    };
  });
}

function attachBenchHints(computed, playersData, playerIdMap, lineupMode) {
  if (!computed) {
    return computed;
  }
  const withPos = (player) => {
    if (!isRealPlayer(player)) {
      return player;
    }
    const info = getPlayerInfo(player.id, playersData, playerIdMap);
    return { ...player, position: info && info.position ? info.position : null };
  };
  const bench = (computed.bench || []).map(withPos);
  const startersIn = (computed.starters || []).map(withPos);
  const starters = lineupMode === 'projections'
    ? attachScoreSoFarHints(startersIn, bench, playersData, playerIdMap)
    : attachBestballProjHints(startersIn, bench, playersData, playerIdMap);
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
    { preferStarted: mode === 'scores' }
  );
}

/**
 * Lineup for Scores.
 * lineupMode 'scores' (default): games that have started stay in the lineup.
 * lineupMode 'projections': rank by ceiling max(score, proj), finished games locked at actual.
 * Header Score always comes from the scores lineup; Proj is always the
 * projections-optimal total — both stay put when the toggle changes who is shown.
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
  const injuriesCtx = { injuriesMap, playersData, playerIdMap };
  const hybrid = applyHybridProjectedPoints(teamScore, projectedPtsById, playerGameLabels);
  const annotated = annotateProjectionSources(hybrid, playerGameLabels, projectedPtsById, injuriesCtx);
  const sortArgs = [
    annotated,
    playersData,
    playerIdMap,
    playerGameLabels,
    injuriesMap,
    playerSeasonTotalsMap,
  ];
  const projSorted = sortLineup(...sortArgs, 'projections');
  const scoresSorted = sortLineup(...sortArgs, 'scores');
  const projFinalized = annotateProjectionSources(projSorted, playerGameLabels, projectedPtsById, injuriesCtx);
  const scoresFinalized = annotateProjectionSources(scoresSorted, playerGameLabels, projectedPtsById, injuriesCtx);
  const optimalProjTotal = roundTenth(
    (projFinalized.starters || []).reduce((sum, player) => sum + projectionSlotValue(player), 0)
  );
  const finalized = mode === 'projections' ? projFinalized : scoresFinalized;
  const withHints = attachBenchHints(finalized, playersData, playerIdMap, mode);
  return {
    ...withHints,
    lineupMode: mode,
    optimalProjTotal,
    starterActualTotal: scoresFinalized.starterActualTotal,
    starterHasActual: scoresFinalized.starterHasActual,
    starterTotal: scoresFinalized.starterTotal,
    starterProjRemaining: scoresFinalized.starterProjRemaining,
    includesProjection: Boolean(
      scoresFinalized.includesProjection || projFinalized.includesProjection
    ),
  };
}
