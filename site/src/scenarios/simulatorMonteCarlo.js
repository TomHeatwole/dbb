/**
 * simulatorMonteCarlo.js
 *
 * Runs N outcome-roll simulations and aggregates league-win rates.
 */

import { buildSleeperBasePoints } from './sleeperScoring';
import {
  computeAllWeeklyScores,
  computeRegSeasonTotals,
  computePlayoffTotals,
  buildFinalStandings,
} from './computeScenarioEval';
import { buildOutcomePool, percentileToOutcomeIndex, buildPlayerProjections } from './outcomeDistribution';
import { collectRequiredSeasonYears } from './computeFutureScenario2Eval';
import { computeLuckFromRolls } from './luckMetrics';

const NUM_WEEKS = 17;
export const DEFAULT_ITERATIONS = 1000;
export const MAX_SIMULATOR_ITERATIONS = 100000;
const MIN_SIMULATOR_ITERATIONS = 1;
const BATCH_SIZE = 25;

export function clampSimulatorIterations(n) {
  const val = Math.round(Number(n) || DEFAULT_ITERATIONS);
  return Math.max(MIN_SIMULATOR_ITERATIONS, Math.min(MAX_SIMULATOR_ITERATIONS, val));
}

function buildProjectedSeasonTotals(playerWeeklyPoints) {
  const totals = {};
  for (const weekPts of playerWeeklyPoints) {
    for (const [pid, pts] of Object.entries(weekPts || {})) {
      totals[pid] = (totals[pid] || 0) + pts;
    }
  }
  return totals;
}

function precomputeOutcomePools(allPlayerIds, hwangAdpRankMap, catalog, positionMaxRanks) {
  const pools = {};
  for (const pid of allPlayerIds) {
    const adpInfo = hwangAdpRankMap && hwangAdpRankMap[pid];
    pools[pid] = adpInfo ? buildOutcomePool(adpInfo, catalog, positionMaxRanks) : [];
  }
  return pools;
}

function precomputeBasePointsByYear(weeklyStatsByYear, scoringConfig, playersData) {
  const basePointsByYear = {};
  for (const [yearStr, weeklyStats] of Object.entries(weeklyStatsByYear || {})) {
    basePointsByYear[yearStr] = buildSleeperBasePoints(
      weeklyStats,
      scoringConfig,
      playersData,
    );
  }
  return basePointsByYear;
}

function buildWeeklyPointsFromRolls(allPlayerIds, pools, basePointsByYear, rolls) {
  return Array.from({ length: NUM_WEEKS }, (_, weekIdx) => {
    const weekPts = {};
    for (const pid of allPlayerIds) {
      const pool = pools[pid];
      if (!pool || pool.length === 0) {
        weekPts[pid] = 0;
        continue;
      }
      const pct = rolls[pid] != null ? Number(rolls[pid]) : 50;
      const idx = percentileToOutcomeIndex(pct, pool.length);
      const outcome = pool[idx];
      if (!outcome) {
        weekPts[pid] = 0;
        continue;
      }
      const yearKey = String(outcome.seasonYear);
      weekPts[pid] = basePointsByYear[yearKey]?.[weekIdx]?.[outcome.sleeperId] ?? 0;
    }
    return weekPts;
  });
}

function randomRolls(allPlayerIds) {
  const rolls = {};
  for (const pid of allPlayerIds) {
    rolls[pid] = Math.floor(Math.random() * 101);
  }
  return rolls;
}

function rostersEqual(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    const left = [...(a?.[key] || [])].sort().join(',');
    const right = [...(b?.[key] || [])].sort().join(',');
    if (left !== right) return false;
  }
  return true;
}

function emptyStats(rosterIds) {
  const stats = {};
  for (const rid of rosterIds) {
    stats[rid] = {
      rosterId: rid,
      wins: 0,
      playoffCount: 0,
      top3Count: 0,
      placeSum: 0,
      regSeasonRankSum: 0,
      regSeasonSum: 0,
      playoffSum: 0,
    };
  }
  return stats;
}

function accumulateIterationStats(stats, champion, standings, regTotals, ploffTotals, regSeasonRankByRid, rosterIds) {
  if (champion) {
    stats[champion.rosterId].wins += 1;
  }

  for (const row of standings) {
    const rid = row.rosterId;
    if (!stats[rid]) continue;
    stats[rid].placeSum += row.place;
    if (row.isPlayoff) stats[rid].playoffCount += 1;
    if (row.place <= 3) stats[rid].top3Count += 1;
    stats[rid].regSeasonRankSum += regSeasonRankByRid[rid] || row.place;
  }

  for (const rid of rosterIds) {
    stats[rid].regSeasonSum += regTotals[rid] || 0;
    stats[rid].playoffSum += ploffTotals[rid] || 0;
  }
}

function buildRegSeasonRankByRid(regTotals) {
  const regSeasonRankByRid = {};
  Object.keys(regTotals)
    .map(Number)
    .sort((a, b) => (regTotals[b] || 0) - (regTotals[a] || 0))
    .forEach((rid, idx) => { regSeasonRankByRid[rid] = idx + 1; });
  return regSeasonRankByRid;
}

function scoreRostersFromRolls(ctx, rosters, rolls, playersData, playerIdMap) {
  const playerWeeklyPoints = buildWeeklyPointsFromRolls(
    ctx.allPlayerIds,
    ctx.pools,
    ctx.basePointsByYear,
    rolls,
  );
  const playerSeasonTotalsMap = buildProjectedSeasonTotals(playerWeeklyPoints);
  const weeklyScores = computeAllWeeklyScores(
    rosters,
    playerWeeklyPoints,
    playersData,
    playerIdMap,
    playerSeasonTotalsMap,
  );

  const regTotals = computeRegSeasonTotals(weeklyScores);
  const ploffTotals = computePlayoffTotals(weeklyScores);
  const standings = buildFinalStandings(regTotals, ploffTotals);
  const champion = standings.find((r) => r.place === 1) || null;

  const teamResults = {};
  for (const row of standings) {
    const rid = row.rosterId;
    const rosterPlayerIds = rosters[rid] || rosters[String(rid)] || [];
    const luck = computeLuckFromRolls(
      rosterPlayerIds,
      rolls,
      ctx.hwangAdpRankMap,
      ctx.pools,
    );
    teamResults[rid] = {
      place: row.place,
      isPlayoff: row.isPlayoff,
      regSeason: regTotals[rid] || 0,
      playoff: ploffTotals[rid] || 0,
      totalScore: (regTotals[rid] || 0) + (ploffTotals[rid] || 0),
      luckPercentile: luck?.totalLuckPercentile ?? null,
    };
  }

  return {
    champion,
    standings,
    regTotals,
    ploffTotals,
    teamResults,
  };
}

function buildResultsFromStats(stats, iterations, rosterIds) {
  return rosterIds.map((rid) => {
    const row = stats[rid];
    const avgRegSeason = row.regSeasonSum / iterations;
    const avgPlayoff = row.playoffSum / iterations;
    return {
      rosterId: rid,
      wins: row.wins,
      winPct: (row.wins / iterations) * 100,
      playoffPct: (row.playoffCount / iterations) * 100,
      top3Pct: (row.top3Count / iterations) * 100,
      avgFinish: row.placeSum / iterations,
      avgRegSeasonRank: row.regSeasonRankSum / iterations,
      avgTotalScore: avgRegSeason + avgPlayoff,
      avgRegSeason,
      avgPlayoff,
    };
  }).sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.avgTotalScore - a.avgTotalScore;
  });
}

/** Deltas vs original-roster baseline (positive = scenario improved). */
export function computeSimulatorResultDeltas(baselineResults, scenarioResults) {
  const baselineById = {};
  (baselineResults || []).forEach((row, idx) => {
    baselineById[row.rosterId] = { ...row, resultsRank: idx + 1 };
  });

  return (scenarioResults || []).map((row, idx) => {
    const base = baselineById[row.rosterId];
    if (!base) return { rosterId: row.rosterId };

    return {
      rosterId: row.rosterId,
      resultsRankDelta: base.resultsRank - (idx + 1),
      winPctDelta: row.winPct - base.winPct,
      playoffPctDelta: row.playoffPct - base.playoffPct,
      top3PctDelta: row.top3Pct - base.top3Pct,
      avgFinishDelta: base.avgFinish - row.avgFinish,
      avgRegSeasonRankDelta: base.avgRegSeasonRank - row.avgRegSeasonRank,
      avgRegSeasonDelta: row.avgRegSeason - base.avgRegSeason,
      avgPlayoffDelta: row.avgPlayoff - base.avgPlayoff,
      avgTotalScoreDelta: row.avgTotalScore - base.avgTotalScore,
    };
  });
}

/**
 * Prepare reusable simulation context (pools + converted weekly stats).
 */
export function prepareSimulatorContext({
  scenarioRosters,
  baselineRosters = null,
  hwangAdpRankMap,
  catalog,
  positionMaxRanks,
  weeklyStatsByYear,
  scoringConfig,
  playersData,
}) {
  const allPlayerIds = new Set();
  for (const rid in scenarioRosters) {
    for (const pid of (scenarioRosters[rid] || [])) allPlayerIds.add(pid);
  }
  const trackBaseline = baselineRosters && !rostersEqual(baselineRosters, scenarioRosters);
  if (trackBaseline) {
    for (const rid in baselineRosters) {
      for (const pid of (baselineRosters[rid] || [])) allPlayerIds.add(pid);
    }
  }

  const playerIdList = [...allPlayerIds];
  const pools = precomputeOutcomePools(playerIdList, hwangAdpRankMap, catalog, positionMaxRanks);
  const basePointsByYear = precomputeBasePointsByYear(weeklyStatsByYear, scoringConfig, playersData);

  const rosterIds = Object.keys(scenarioRosters).map(Number);

  return {
    scenarioRosters,
    baselineRosters: trackBaseline ? baselineRosters : null,
    hwangAdpRankMap,
    allPlayerIds: playerIdList,
    pools,
    basePointsByYear,
    rosterIds,
  };
}

/**
 * Determine required Sleeper stat years for a scenario (same as single eval).
 */
export function getSimulatorRequiredYears(context, hwangAdpRankMap, catalog, positionMaxRanks) {
  const projections = buildPlayerProjections(
    context.allPlayerIds,
    hwangAdpRankMap,
    catalog,
    positionMaxRanks,
    Object.fromEntries(context.allPlayerIds.map((pid) => [pid, 50])),
  );
  return collectRequiredSeasonYears(projections);
}

function runSingleIteration(ctx, playersData, playerIdMap) {
  const rolls = randomRolls(ctx.allPlayerIds);
  const scenarioOutcome = scoreRostersFromRolls(
    ctx,
    ctx.scenarioRosters,
    rolls,
    playersData,
    playerIdMap,
  );

  let baselineOutcome = null;
  if (ctx.baselineRosters) {
    baselineOutcome = scoreRostersFromRolls(
      ctx,
      ctx.baselineRosters,
      rolls,
      playersData,
      playerIdMap,
    );
  }

  return {
    rolls,
    champion: scenarioOutcome.champion,
    standings: scenarioOutcome.standings,
    regTotals: scenarioOutcome.regTotals,
    ploffTotals: scenarioOutcome.ploffTotals,
    teamResults: scenarioOutcome.teamResults,
    baselineOutcome,
  };
}

/**
 * @returns {Promise<{
 *   results: Array,
 *   simRuns: Array<{ simIndex, rolls, teamResults }>,
 * }>}
 */
export async function runMonteCarloSimulation(
  ctx,
  playersData,
  playerIdMap,
  {
    iterations = DEFAULT_ITERATIONS,
    onProgress,
    batchSize = BATCH_SIZE,
  } = {},
) {
  const stats = emptyStats(ctx.rosterIds);
  const baselineStats = ctx.baselineRosters ? emptyStats(ctx.rosterIds) : null;

  const simRuns = [];
  let completed = 0;

  while (completed < iterations) {
    const batchEnd = Math.min(completed + batchSize, iterations);
    for (let i = completed; i < batchEnd; i++) {
      const {
        rolls,
        champion,
        standings,
        regTotals,
        ploffTotals,
        teamResults,
        baselineOutcome,
      } = runSingleIteration(ctx, playersData, playerIdMap);

      simRuns.push({ simIndex: i + 1, rolls, teamResults });

      const regSeasonRankByRid = buildRegSeasonRankByRid(regTotals);
      accumulateIterationStats(
        stats,
        champion,
        standings,
        regTotals,
        ploffTotals,
        regSeasonRankByRid,
        ctx.rosterIds,
      );

      if (baselineOutcome && baselineStats) {
        const baselineRegSeasonRankByRid = buildRegSeasonRankByRid(baselineOutcome.regTotals);
        accumulateIterationStats(
          baselineStats,
          baselineOutcome.champion,
          baselineOutcome.standings,
          baselineOutcome.regTotals,
          baselineOutcome.ploffTotals,
          baselineRegSeasonRankByRid,
          ctx.rosterIds,
        );
      }
    }

    completed = batchEnd;
    if (onProgress) {
      onProgress(completed / iterations);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const results = buildResultsFromStats(stats, iterations, ctx.rosterIds);
  const baselineResults = baselineStats
    ? buildResultsFromStats(baselineStats, iterations, ctx.rosterIds)
    : null;
  const resultDeltas = baselineResults
    ? computeSimulatorResultDeltas(baselineResults, results)
    : null;

  return { results, baselineResults, resultDeltas, simRuns };
}
