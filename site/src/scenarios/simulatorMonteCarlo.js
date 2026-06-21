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

/**
 * Prepare reusable simulation context (pools + converted weekly stats).
 */
export function prepareSimulatorContext({
  scenarioRosters,
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

  const playerIdList = [...allPlayerIds];
  const pools = precomputeOutcomePools(playerIdList, hwangAdpRankMap, catalog, positionMaxRanks);
  const basePointsByYear = precomputeBasePointsByYear(weeklyStatsByYear, scoringConfig, playersData);

  const rosterIds = Object.keys(scenarioRosters).map(Number);

  return {
    scenarioRosters,
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
  const playerWeeklyPoints = buildWeeklyPointsFromRolls(
    ctx.allPlayerIds,
    ctx.pools,
    ctx.basePointsByYear,
    rolls,
  );
  const playerSeasonTotalsMap = buildProjectedSeasonTotals(playerWeeklyPoints);
  const scenarioWeeklyScores = computeAllWeeklyScores(
    ctx.scenarioRosters,
    playerWeeklyPoints,
    playersData,
    playerIdMap,
    playerSeasonTotalsMap,
  );

  const regTotals = computeRegSeasonTotals(scenarioWeeklyScores);
  const ploffTotals = computePlayoffTotals(scenarioWeeklyScores);
  const standings = buildFinalStandings(regTotals, ploffTotals);
  const champion = standings.find((r) => r.place === 1) || null;

  const teamResults = {};
  for (const row of standings) {
    const rid = row.rosterId;
    const reg = regTotals[rid] || 0;
    const ploff = ploffTotals[rid] || 0;
    const rosterPlayerIds = ctx.scenarioRosters[rid]
      || ctx.scenarioRosters[String(rid)]
      || [];
    const luck = computeLuckFromRolls(
      rosterPlayerIds,
      rolls,
      ctx.hwangAdpRankMap,
      ctx.pools,
    );
    teamResults[rid] = {
      place: row.place,
      isPlayoff: row.isPlayoff,
      regSeason: reg,
      playoff: ploff,
      totalScore: reg + ploff,
      luckPercentile: luck?.totalLuckPercentile ?? null,
    };
  }

  return { rolls, champion, standings, regTotals, ploffTotals, teamResults };
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
  const stats = {};
  for (const rid of ctx.rosterIds) {
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

  const simRuns = [];
  let completed = 0;

  while (completed < iterations) {
    const batchEnd = Math.min(completed + batchSize, iterations);
    for (let i = completed; i < batchEnd; i++) {
      const {
        rolls, champion, standings, regTotals, ploffTotals, teamResults,
      } = runSingleIteration(ctx, playersData, playerIdMap);

      simRuns.push({ simIndex: i + 1, rolls, teamResults });

      if (champion) {
        stats[champion.rosterId].wins += 1;
      }

      const regSeasonRankByRid = {};
      Object.keys(regTotals)
        .map(Number)
        .sort((a, b) => (regTotals[b] || 0) - (regTotals[a] || 0))
        .forEach((rid, idx) => { regSeasonRankByRid[rid] = idx + 1; });

      for (const row of standings) {
        const rid = row.rosterId;
        if (!stats[rid]) continue;
        stats[rid].placeSum += row.place;
        if (row.isPlayoff) stats[rid].playoffCount += 1;
        if (row.place <= 3) stats[rid].top3Count += 1;
        stats[rid].regSeasonRankSum += regSeasonRankByRid[rid] || row.place;
      }

      for (const rid of ctx.rosterIds) {
        stats[rid].regSeasonSum += regTotals[rid] || 0;
        stats[rid].playoffSum += ploffTotals[rid] || 0;
      }
    }

    completed = batchEnd;
    if (onProgress) {
      onProgress(completed / iterations);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const results = ctx.rosterIds.map((rid) => {
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

  return { results, simRuns };
}
