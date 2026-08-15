/**
 * computeFutureScenario2Eval.js
 *
 * Future Scenarios v2: projects current rosters by rolling percentile outcomes
 * from monotonic, synthetic-densified pools built from historical Hwang ADP
 * ±2 windows (weeks 1–14; see outcomeDistribution.js). Weeks 15–17 are a
 * second independent roll from real historical playoff weeks conditioned on
 * the realized regular-season total.
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
  materializeOutcomeWeeks,
  buildPlayoffIndex,
  overlayPlayoffWeeks,
  attachPlayoffProjection,
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
 * Each player borrows weeks 1–14 from their selected ADP-pool outcome, then
 * independently rolls weeks 15–17 from real historical playoff weeks of
 * seasons with similar regular-season scoring.
 */
export function buildOutcomeProjectionPoints(
  allRosters,
  playerProjections,
  weeklyStatsByYear,
  scoringConfig,
  playersData,
  catalog,
  playoffRolls = {},
) {
  const basePointsByYear = {};

  for (const [yearStr, weeklyStats] of Object.entries(weeklyStatsByYear || {})) {
    basePointsByYear[yearStr] = buildSleeperBasePoints(
      weeklyStats,
      scoringConfig,
      playersData,
    );
  }

  const playoffIndex = buildPlayoffIndex(catalog, basePointsByYear, NUM_WEEKS);

  const allCurrentPlayerIds = new Set();
  for (const rid in allRosters) {
    for (const pid of (allRosters[rid] || [])) allCurrentPlayerIds.add(pid);
  }

  const weeksByPid = {};
  for (const currentPid of allCurrentPlayerIds) {
    const proj = playerProjections && playerProjections[currentPid];
    const outcome = proj?.selectedOutcome;
    let weeks = outcome
      ? materializeOutcomeWeeks(outcome, basePointsByYear, NUM_WEEKS)
      : null;
    if (weeks && proj && !proj.unranked) {
      const next = attachPlayoffProjection(
        proj,
        playoffIndex,
        weeks,
        playoffRolls[currentPid],
      );
      playerProjections[currentPid] = next;
      weeks = overlayPlayoffWeeks(weeks, next.selectedPlayoffOutcome) || weeks;
    }
    weeksByPid[currentPid] = weeks;
  }

  return Array.from({ length: NUM_WEEKS }, (_, weekIdx) => {
    const weekPts = {};
    for (const currentPid of allCurrentPlayerIds) {
      weekPts[currentPid] = weeksByPid[currentPid]?.[weekIdx] ?? 0;
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
  playoffRolls = {},
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
    catalog,
    playoffRolls,
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
