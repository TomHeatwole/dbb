/**
 * computeFutureScenario2Eval.js
 *
 * Future Scenarios v2: projects current rosters by rolling percentile outcomes
 * from a Gaussian-ish pool built from historical Hwang ADP ±5 windows.
 */

import { buildSleeperBasePoints } from './sleeperScoring';
import {
  computeAllWeeklyScores,
  computeRegSeasonTotals,
  computePlayoffTotals,
  buildFinalStandings,
} from './computeScenarioEval';
import {
  buildPlayerProjections,
  collectRequiredSeasonYears,
} from './outcomeDistribution';

const NUM_WEEKS = 17;

function buildProjectedSeasonTotals(playerWeeklyPoints) {
  const totals = {};
  for (const weekPts of playerWeeklyPoints) {
    for (const [pid, pts] of Object.entries(weekPts || {})) {
      totals[pid] = (totals[pid] || 0) + pts;
    }
  }
  return totals;
}

/**
 * Build weekly points using rolled historical outcomes.
 * Each player borrows weekly stats from their selected outcome's season.
 */
export function buildOutcomeProjectionPoints(
  allRosters,
  playerProjections,
  weeklyStatsByYear,
  scoringConfig,
  playersData,
) {
  const basePointsByYear = {};

  for (const [yearStr, weeklyStats] of Object.entries(weeklyStatsByYear || {})) {
    basePointsByYear[yearStr] = buildSleeperBasePoints(
      weeklyStats,
      scoringConfig,
      playersData,
    );
  }

  const allCurrentPlayerIds = new Set();
  for (const rid in allRosters) {
    for (const pid of (allRosters[rid] || [])) allCurrentPlayerIds.add(pid);
  }

  return Array.from({ length: NUM_WEEKS }, (_, weekIdx) => {
    const weekPts = {};

    for (const currentPid of allCurrentPlayerIds) {
      const proj = playerProjections && playerProjections[currentPid];
      const outcome = proj?.selectedOutcome;

      if (!outcome) {
        weekPts[currentPid] = 0;
        continue;
      }

      const yearKey = String(outcome.seasonYear);
      const historicalBasePoints = basePointsByYear[yearKey];
      if (!historicalBasePoints) {
        weekPts[currentPid] = 0;
        continue;
      }

      weekPts[currentPid] = historicalBasePoints[weekIdx]?.[outcome.sleeperId] ?? 0;
    }

    return weekPts;
  });
}

/**
 * @param {Object} weeklyStatsByYear  { [year]: 17-element array of raw stats }
 */
export function computeFutureScenario2Eval(
  originalRosters,
  scenarioRosters,
  hwangAdpRankMap,
  catalog,
  positionMaxRanks,
  percentileRolls,
  weeklyStatsByYear,
  scoringConfig,
  playersData,
  playerIdMap,
) {
  const combinedRosters = {};
  const allRids = new Set([
    ...Object.keys(originalRosters || {}),
    ...Object.keys(scenarioRosters || {}),
  ]);
  for (const rid of allRids) {
    const orig = originalRosters[rid] || [];
    const scen = scenarioRosters[rid] || [];
    combinedRosters[rid] = [...new Set([...orig, ...scen])];
  }

  const allPlayerIds = new Set();
  for (const rid in combinedRosters) {
    for (const pid of combinedRosters[rid]) allPlayerIds.add(pid);
  }

  const playerProjections = buildPlayerProjections(
    allPlayerIds,
    hwangAdpRankMap,
    catalog,
    positionMaxRanks,
    percentileRolls,
  );

  const playerWeeklyPoints = buildOutcomeProjectionPoints(
    combinedRosters,
    playerProjections,
    weeklyStatsByYear,
    scoringConfig,
    playersData,
  );

  const playerSeasonTotalsMap = buildProjectedSeasonTotals(playerWeeklyPoints);

  const originalWeeklyScores = computeAllWeeklyScores(
    originalRosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap,
  );
  const scenarioWeeklyScores = computeAllWeeklyScores(
    scenarioRosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap,
  );

  const originalRegTotals = computeRegSeasonTotals(originalWeeklyScores);
  const originalPloffTotals = computePlayoffTotals(originalWeeklyScores);
  const scenarioRegTotals = computeRegSeasonTotals(scenarioWeeklyScores);
  const scenarioPloffTotals = computePlayoffTotals(scenarioWeeklyScores);

  const originalStandings = buildFinalStandings(originalRegTotals, originalPloffTotals);
  const scenarioStandings = buildFinalStandings(scenarioRegTotals, scenarioPloffTotals);

  const teamDeltas = Object.keys(originalRosters).map(Number).map((rid) => {
    const origRow = originalStandings.find((r) => r.rosterId === rid) || {};
    const scenRow = scenarioStandings.find((r) => r.rosterId === rid) || {};
    return {
      rosterId: rid,
      originalPlace: origRow.place ?? null,
      regSeasonDelta: Math.round(((scenarioRegTotals[rid] || 0) - (originalRegTotals[rid] || 0)) * 10) / 10,
      playoffDelta: Math.round(((scenarioPloffTotals[rid] || 0) - (originalPloffTotals[rid] || 0)) * 10) / 10,
      isPlayoff: scenRow.isPlayoff || false,
    };
  });

  return {
    originalWeeklyScores,
    scenarioWeeklyScores,
    originalStandings,
    scenarioStandings,
    teamDeltas,
    playerWeeklyPoints,
    playerProjections,
  };
}

export { collectRequiredSeasonYears };
