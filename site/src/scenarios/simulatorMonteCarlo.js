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

const NUM_WEEKS = 17;
const DEFAULT_ITERATIONS = 1000;
const BATCH_SIZE = 25;

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

  return { champion, standings, regTotals, ploffTotals };
}

/**
 * @returns {Promise<Array<{ rosterId, wins, winPct, avgTotalScore, avgRegSeason, avgPlayoff }>>}
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

  let completed = 0;

  while (completed < iterations) {
    const batchEnd = Math.min(completed + batchSize, iterations);
    for (let i = completed; i < batchEnd; i++) {
      const { champion, standings, regTotals, ploffTotals } = runSingleIteration(
        ctx, playersData, playerIdMap,
      );

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

  return ctx.rosterIds.map((rid) => {
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

export { DEFAULT_ITERATIONS };
