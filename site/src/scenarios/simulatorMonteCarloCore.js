/**
 * simulatorMonteCarloCore.js
 *
 * Hot-loop Monte Carlo engine — runs on main thread or inside a Web Worker.
 */

import { buildFinalStandings } from './computeScenarioEval';
import {
  buildOutcomePool,
  buildPoolCumulativeWeights,
  buildPlayoffIndex,
  materializeOutcomeWeeks,
  percentileToOutcomeIndex,
  selectPlayoffOutcome,
} from './outcomeDistribution';
import { buildSleeperBasePoints } from './sleeperScoring';
import { computeLuckFromRolls } from './luckMetrics';
import { scoreAllRostersFast, buildPlayerPositionsMap } from './simulatorLineup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import {
  createTeamScoreHistograms,
  accumulateTeamScoreHistograms,
  serializeTeamScoreHistograms,
  createTeamSlotHistograms,
  accumulateTeamSlotHistograms,
  serializeTeamSlotHistograms,
} from './simulatorHistograms';

const NUM_WEEKS = 17;
const REG_SEASON_WEEKS = 14;
const MAX_RUNS_PER_FINISH = 50;
const ZERO_WEEKS = new Float32Array(NUM_WEEKS);

export const DEFAULT_ITERATIONS = 1000;
export const MAX_SIMULATOR_ITERATIONS = 1_000_000;
export const SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS = 5000;

const BATCH_SIZE = 25;
const LIGHTWEIGHT_BATCH_SIZE = 2000;
const PROGRESS_TIME_MS = 80;

function getLightweightProgressInterval(iterations) {
  return Math.max(500, Math.floor(iterations / 200));
}

export function clampSimulatorIterations(n) {
  const val = Math.round(Number(n) || DEFAULT_ITERATIONS);
  return Math.max(1, Math.min(MAX_SIMULATOR_ITERATIONS, val));
}

export function isLightweightSimulatorRun(iterations) {
  return clampSimulatorIterations(iterations) > SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS;
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

function precomputeOutcomePools(allPlayerIds, hwangAdpRankMap, catalog, positionMaxRanks, variance, monotone) {
  const pools = {};
  for (const pid of allPlayerIds) {
    const adpInfo = hwangAdpRankMap && hwangAdpRankMap[pid];
    pools[pid] = adpInfo
      ? buildOutcomePool(adpInfo, catalog, positionMaxRanks, { variance, monotone })
      : [];
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

function precomputeOutcomeWeekPoints(allPlayerIds, pools, basePointsByYear) {
  const outcomeWeekPts = {};
  for (const pid of allPlayerIds) {
    const pool = pools[pid] || [];
    outcomeWeekPts[pid] = pool.map(
      (outcome) => Float32Array.from(materializeOutcomeWeeks(outcome, basePointsByYear, NUM_WEEKS)),
    );
  }
  return outcomeWeekPts;
}

function createRuntimeBuffers(allPlayerIds) {
  return {
    weekBuffers: Array.from({ length: NUM_WEEKS }, () => ({})),
    seasonTotals: {},
    rolls: {},
    playoffRolls: {},
  };
}

function fillRandomRolls(allPlayerIds, rolls, playoffRolls = {}) {
  for (const pid of allPlayerIds) {
    rolls[pid] = (Math.random() * 101) | 0;
    playoffRolls[pid] = (Math.random() * 101) | 0;
  }
}

function fillWeeklyFromRolls(ctx) {
  const {
    allPlayerIds, pools, poolCumWeights, outcomeWeekPts, playoffIndex,
    playerPositions, weekBuffers, seasonTotals, rolls, playoffRolls,
  } = ctx;

  for (const pid of allPlayerIds) {
    const poolLen = pools[pid]?.length ?? 0;
    if (poolLen === 0) {
      for (let wi = 0; wi < NUM_WEEKS; wi++) weekBuffers[wi][pid] = 0;
      seasonTotals[pid] = 0;
      continue;
    }
    const pct = rolls[pid] ?? 50;
    const idx = percentileToOutcomeIndex(pct, poolLen, poolCumWeights[pid]);
    const ptsArr = outcomeWeekPts[pid][idx] || ZERO_WEEKS;

    let total = 0;
    let reg = 0;
    for (let wi = 0; wi < REG_SEASON_WEEKS; wi++) {
      const p = ptsArr[wi];
      weekBuffers[wi][pid] = p;
      total += p;
      reg += p;
    }
    const pos = playerPositions[pid];
    const poSel = playoffIndex
      ? selectPlayoffOutcome(playoffIndex, pos, reg, (playoffRolls || {})[pid] ?? 50)
      : { outcome: null };
    const po = poSel.outcome?.po;
    for (let k = 0; k < 3; k++) {
      const p = po ? po[k] : (ptsArr[REG_SEASON_WEEKS + k] || 0);
      weekBuffers[REG_SEASON_WEEKS + k][pid] = p;
      total += p;
    }
    seasonTotals[pid] = total;
  }
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

function buildRegSeasonRankByRid(regTotals) {
  const regSeasonRankByRid = {};
  Object.keys(regTotals)
    .map(Number)
    .sort((a, b) => (regTotals[b] || 0) - (regTotals[a] || 0))
    .forEach((rid, idx) => { regSeasonRankByRid[rid] = idx + 1; });
  return regSeasonRankByRid;
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

function createTeamFinishBuckets(rosterIds) {
  const byTeam = {};
  for (const rid of rosterIds) {
    byTeam[rid] = Array.from({ length: 10 }, (_, i) => ({
      place: i + 1,
      count: 0,
      runs: [],
    }));
  }
  return byTeam;
}

function incrementTeamFinishCount(buckets, rosterId, place) {
  if (place == null || place < 1 || place > 10) return;
  const rid = Number(rosterId);
  const teamBuckets = buckets[rid];
  if (!teamBuckets) return;
  teamBuckets[place - 1].count += 1;
}

function cloneRollMap(rolls) {
  return { ...rolls };
}

function createTeamSeasonExtremes(rosterIds) {
  const byTeam = {};
  for (const rid of rosterIds) {
    byTeam[rid] = { best: null, worst: null };
  }
  return byTeam;
}

function buildSeasonExtremeSample(simIndex, ctx, rosterId, totalScore, place) {
  const rid = Number(rosterId);
  const rosterPlayerIds = ctx.scenarioRosters[rid]
    || ctx.scenarioRosters[String(rid)]
    || [];
  const luck = computeLuckFromRolls(
    rosterPlayerIds,
    ctx.rolls,
    ctx.hwangAdpRankMap,
    ctx.pools,
  );
  return {
    simIndex,
    rolls: cloneRollMap(ctx.rolls),
    playoffRolls: cloneRollMap(ctx.playoffRolls),
    totalScore,
    place,
    luckPercentile: luck?.totalLuckPercentile ?? null,
  };
}

/** Keep each team's highest- and lowest-scoring seasons (2 samples, any run size). */
function recordTeamSeasonExtreme(extremes, rosterId, simIndex, ctx, totalScore, place) {
  if (totalScore == null || !Number.isFinite(totalScore)) return;
  const rid = Number(rosterId);
  const team = extremes[rid];
  if (!team) return;

  const isBest = !team.best || totalScore > team.best.totalScore;
  const isWorst = !team.worst || totalScore < team.worst.totalScore;
  if (!isBest && !isWorst) return;

  const sample = buildSeasonExtremeSample(simIndex, ctx, rid, totalScore, place);
  if (isBest) team.best = sample;
  if (isWorst) team.worst = sample;
}

function recordTeamFinishSample(buckets, rosterId, simIndex, rolls, playoffRolls, teamResult) {
  const place = teamResult?.place;
  if (place == null || place < 1 || place > 10) return;

  const rid = Number(rosterId);
  const teamBuckets = buckets[rid];
  if (!teamBuckets) return;

  const bucket = teamBuckets[place - 1];

  const entry = {
    simIndex,
    rolls: { ...rolls },
    playoffRolls: { ...playoffRolls },
    totalScore: teamResult.totalScore,
    luckPercentile: teamResult.luckPercentile ?? null,
  };

  if (bucket.runs.length < MAX_RUNS_PER_FINISH) {
    bucket.runs.push(entry);
    if (bucket.runs.length === MAX_RUNS_PER_FINISH) {
      bucket.runs.sort((a, b) => b.totalScore - a.totalScore);
    }
    return;
  }

  const worstKept = bucket.runs[bucket.runs.length - 1];
  if (entry.totalScore <= worstKept.totalScore) return;

  let insertAt = bucket.runs.length - 1;
  while (insertAt > 0 && entry.totalScore > bucket.runs[insertAt - 1].totalScore) {
    insertAt -= 1;
  }
  bucket.runs.splice(insertAt, 0, entry);
  bucket.runs.length = MAX_RUNS_PER_FINISH;
}

function scoreRostersFromWeekly(ctx, rosters, lightweight) {
  const { weekBuffers, seasonTotals, playerPositions, rolls, hwangAdpRankMap, pools } = ctx;
  const { regTotals, ploffTotals, slotReg, slotPloff } = scoreAllRostersFast(
    rosters,
    weekBuffers,
    playerPositions,
    seasonTotals,
  );
  const standings = buildFinalStandings(regTotals, ploffTotals);
  const champion = standings.find((r) => r.place === 1) || null;

  if (lightweight) {
    return { champion, standings, regTotals, ploffTotals, slotReg, slotPloff };
  }

  const teamResults = {};
  for (const row of standings) {
    const rid = row.rosterId;
    const rosterPlayerIds = rosters[rid] || rosters[String(rid)] || [];
    const luck = computeLuckFromRolls(
      rosterPlayerIds,
      rolls,
      hwangAdpRankMap,
      pools,
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

  return { champion, standings, regTotals, ploffTotals, slotReg, slotPloff, teamResults };
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
 * Prepare reusable simulation context with precomputed outcome weekly points.
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
  variance,
  monotone,
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
  const pools = precomputeOutcomePools(playerIdList, hwangAdpRankMap, catalog, positionMaxRanks, variance, monotone);
  const poolCumWeights = {};
  for (const pid of playerIdList) {
    poolCumWeights[pid] = buildPoolCumulativeWeights(pools[pid]);
  }
  const basePointsByYear = precomputeBasePointsByYear(weeklyStatsByYear, scoringConfig, playersData);
  const outcomeWeekPts = precomputeOutcomeWeekPoints(playerIdList, pools, basePointsByYear);
  const playoffIndex = buildPlayoffIndex(catalog, basePointsByYear, NUM_WEEKS);
  const playerPositions = buildPlayerPositionsMap(playerIdList, playersData);
  const runtime = createRuntimeBuffers(playerIdList);
  const rosterIds = Object.keys(scenarioRosters).map(Number);

  return {
    scenarioRosters,
    baselineRosters: trackBaseline ? baselineRosters : null,
    hwangAdpRankMap,
    allPlayerIds: playerIdList,
    pools,
    poolCumWeights,
    outcomeWeekPts,
    playoffIndex,
    playerPositions,
    rosterIds,
    ...runtime,
  };
}

export function createSimulationState(ctx, lightweight) {
  const slotNames = STARTER_POSITION_NAMES || [];
  return {
    stats: emptyStats(ctx.rosterIds),
    baselineStats: ctx.baselineRosters ? emptyStats(ctx.rosterIds) : null,
    teamFinishBuckets: createTeamFinishBuckets(ctx.rosterIds),
    teamSeasonExtremes: createTeamSeasonExtremes(ctx.rosterIds),
    teamScoreHistograms: createTeamScoreHistograms(ctx.rosterIds),
    teamSlotHistograms: createTeamSlotHistograms(ctx.rosterIds, slotNames),
    keepSimSamples: !lightweight,
    completed: 0,
  };
}

export function runSimulationIterations(ctx, state, {
  count,
  startIndex = 0,
  lightweight,
  onProgress,
  progressInterval,
  totalIterations,
}) {
  const {
    stats, baselineStats, teamFinishBuckets, teamSeasonExtremes,
    teamScoreHistograms, teamSlotHistograms, keepSimSamples,
  } = state;
  const reportEvery = progressInterval
    ?? (lightweight
      ? getLightweightProgressInterval(totalIterations || count)
      : Math.max(1, Math.floor((totalIterations || count) / 100)));

  let lastReported = startIndex;
  let lastReportTime = Date.now();

  for (let i = 0; i < count; i++) {
    const simIndex = startIndex + i;

    fillRandomRolls(ctx.allPlayerIds, ctx.rolls, ctx.playoffRolls);
    fillWeeklyFromRolls(ctx);

    const scenarioOutcome = scoreRostersFromWeekly(ctx, ctx.scenarioRosters, !keepSimSamples);

    let baselineOutcome = null;
    if (ctx.baselineRosters) {
      baselineOutcome = scoreRostersFromWeekly(ctx, ctx.baselineRosters, !keepSimSamples);
    }

    for (const row of scenarioOutcome.standings) {
      incrementTeamFinishCount(teamFinishBuckets, row.rosterId, row.place);
      const totalScore = (scenarioOutcome.regTotals[row.rosterId] || 0)
        + (scenarioOutcome.ploffTotals[row.rosterId] || 0);
      recordTeamSeasonExtreme(
        teamSeasonExtremes,
        row.rosterId,
        simIndex + 1,
        ctx,
        totalScore,
        row.place,
      );
    }

    accumulateTeamScoreHistograms(
      teamScoreHistograms,
      scenarioOutcome.regTotals,
      scenarioOutcome.ploffTotals,
      ctx.rosterIds,
    );

    accumulateTeamSlotHistograms(
      teamSlotHistograms,
      scenarioOutcome.slotReg,
      scenarioOutcome.slotPloff,
      ctx.rosterIds,
    );

    if (keepSimSamples) {
      for (const [rid, tr] of Object.entries(scenarioOutcome.teamResults || {})) {
        recordTeamFinishSample(teamFinishBuckets, rid, simIndex + 1, ctx.rolls, ctx.playoffRolls, tr);
      }
    }

    const regSeasonRankByRid = buildRegSeasonRankByRid(scenarioOutcome.regTotals);
    accumulateIterationStats(
      stats,
      scenarioOutcome.champion,
      scenarioOutcome.standings,
      scenarioOutcome.regTotals,
      scenarioOutcome.ploffTotals,
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

    const done = simIndex + 1;
    const now = Date.now();
    if (
      done - lastReported >= reportEvery
      || now - lastReportTime >= PROGRESS_TIME_MS
      || done === totalIterations
    ) {
      lastReported = done;
      lastReportTime = now;
      if (onProgress) {
        onProgress(done / totalIterations);
      }
    }
  }

  state.completed = startIndex + count;
}

export function finalizeSimulationState(state, iterations, rosterIds) {
  const {
    stats, baselineStats, teamFinishBuckets, teamSeasonExtremes,
    teamScoreHistograms, teamSlotHistograms,
  } = state;
  const results = buildResultsFromStats(stats, iterations, rosterIds);
  const baselineResults = baselineStats
    ? buildResultsFromStats(baselineStats, iterations, rosterIds)
    : null;
  const resultDeltas = baselineResults
    ? computeSimulatorResultDeltas(baselineResults, results)
    : null;

  return {
    results,
    baselineResults,
    resultDeltas,
    teamFinishBuckets,
    teamSeasonExtremes,
    teamScoreHistograms: serializeTeamScoreHistograms(teamScoreHistograms),
    teamSlotHistograms: serializeTeamSlotHistograms(teamSlotHistograms),
  };
}

/**
 * Synchronous Monte Carlo loop. Used directly in Worker; main thread wraps with yields.
 */
export function runMonteCarloSimulationSync(ctx, {
  iterations = DEFAULT_ITERATIONS,
  lightweight = isLightweightSimulatorRun(iterations),
  onProgress,
  progressInterval,
} = {}) {
  const state = createSimulationState(ctx, lightweight);
  runSimulationIterations(ctx, state, {
    count: iterations,
    startIndex: 0,
    lightweight,
    onProgress,
    progressInterval,
    totalIterations: iterations,
  });
  return finalizeSimulationState(state, iterations, ctx.rosterIds);
}

export { BATCH_SIZE, LIGHTWEIGHT_BATCH_SIZE };
