/**
 * computePosValueCompare.js
 *
 * Compare cross-position players at similar dynasty values by HVORP on a roster.
 * Value source is arbitrary (KTC, redraft index, etc.) — callers pass { name, position, value, playerId }.
 *
 * V0 uses an empty base roster; HVORP equals optimal lineup contribution vs roster without the player.
 */

import {
  computeAllWeeklyScores,
  computePlayerRosterStats,
} from '../scenarios/computeScenarioEval';
import {
  filterTopKtcPlayers,
  groupHvorpPctDelta,
  hvorpPctDelta,
  TOP_KTC_RANK,
} from './posValueCompareMetrics';

export const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/** V0 — replace with real roster player IDs when wiring roster input. */
export const EMPTY_ROSTER = [];

const ROSTER_KEY = 'compare';

/** Default max |valueA − valueB| for a cross-position pair. */
export const DEFAULT_VALUE_TOLERANCE = 200;

export { TOP_KTC_RANK, filterTopKtcPlayers, hvorpPctDelta, groupHvorpPctDelta };

function pairKey(posA, posB) {
  return `${posA}_vs_${posB}`;
}

function valuesMatch(valueA, valueB, tolerance) {
  if (valueA == null || valueB == null) return false;
  const tol = tolerance ?? DEFAULT_VALUE_TOLERANCE;
  const avg = (valueA + valueB) / 2;
  const dynamicTol = Math.max(tol, avg * 0.02);
  return Math.abs(valueA - valueB) <= dynamicTol;
}

/**
 * HVORP for one player added to baseRoster (optimal lineup with vs without).
 */
export function computePlayerHvorp(
  baseRosterPlayerIds,
  playerId,
  playerWeeklyPoints,
  playersData,
  playerIdMap,
  playerSeasonTotalsMap,
) {
  if (!playerId || playerId === '0') return null;

  const roster = [...(baseRosterPlayerIds || []), playerId];
  const rosters = { [ROSTER_KEY]: roster };
  const weeklyScores = computeAllWeeklyScores(
    rosters,
    playerWeeklyPoints,
    playersData,
    playerIdMap,
    playerSeasonTotalsMap,
  );
  const stats = computePlayerRosterStats(
    ROSTER_KEY,
    roster,
    weeklyScores,
    playerWeeklyPoints,
    playersData,
    playerIdMap,
    playerSeasonTotalsMap,
  );
  const row = stats.find((s) => s.playerId === playerId);
  return row?.hvorp ?? null;
}

/**
 * Pre-compute HVORP for every player that has a resolvable playerId and played.
 */
export function buildHvorpLookup(
  players,
  baseRoster,
  playerWeeklyPoints,
  playersData,
  playerIdMap,
  playerSeasonTotalsMap,
) {
  const lookup = new Map();
  for (const player of players || []) {
    const pid = player.playerId;
    if (!pid || lookup.has(pid)) continue;

    const hvorp = computePlayerHvorp(
      baseRoster,
      pid,
      playerWeeklyPoints,
      playersData,
      playerIdMap,
      playerSeasonTotalsMap,
    );
    if (hvorp == null) continue;

    const totalScore = (playerWeeklyPoints || []).reduce(
      (sum, week) => sum + (week[pid] ?? 0),
      0,
    );
    if (totalScore <= 0) continue;

    lookup.set(pid, {
      ...player,
      hvorp,
      totalScore: Math.round(totalScore * 10) / 10,
    });
  }
  return lookup;
}

/**
 * All cross-position pairs within value tolerance.
 */
export function findValueMatchedPairs(playersWithHvorp, tolerance = DEFAULT_VALUE_TOLERANCE) {
  const byPosition = {};
  for (const pos of POSITIONS) byPosition[pos] = [];

  for (const player of playersWithHvorp) {
    const pos = (player.position || '').toUpperCase();
    if (!POSITIONS.includes(pos)) continue;
    byPosition[pos].push(player);
  }

  const comparisons = [];

  for (let i = 0; i < POSITIONS.length; i += 1) {
    for (let j = i + 1; j < POSITIONS.length; j += 1) {
      const posA = POSITIONS[i];
      const posB = POSITIONS[j];
      const listA = byPosition[posA];
      const listB = byPosition[posB];

      for (const playerA of listA) {
        for (const playerB of listB) {
          if (!valuesMatch(playerA.value, playerB.value, tolerance)) continue;

          const delta = Math.round((playerA.hvorp - playerB.hvorp) * 10) / 10;
          comparisons.push({
            posA,
            posB,
            pairKey: pairKey(posA, posB),
            playerA: playerA.name,
            playerB: playerB.name,
            playerIdA: playerA.playerId,
            playerIdB: playerB.playerId,
            valueA: playerA.value,
            valueB: playerB.value,
            valueGap: Math.round((playerA.value - playerB.value) * 10) / 10,
            hvorpA: playerA.hvorp,
            hvorpB: playerB.hvorp,
            delta,
            pctDelta: hvorpPctDelta(playerA.hvorp, playerB.hvorp, delta),
          });
        }
      }
    }
  }

  return comparisons;
}

function aggregateComparisons(comparisons) {
  const byPair = {};
  for (const posA of POSITIONS) {
    for (let j = POSITIONS.indexOf(posA) + 1; j < POSITIONS.length; j += 1) {
      const posB = POSITIONS[j];
      byPair[pairKey(posA, posB)] = {
        posA,
        posB,
        label: `${posA} vs ${posB}`,
        comparisons: [],
        avgDelta: null,
        avgPctDelta: null,
        count: 0,
      };
    }
  }

  for (const row of comparisons) {
    const bucket = byPair[row.pairKey];
    if (!bucket) continue;
    bucket.comparisons.push(row);
  }

  for (const bucket of Object.values(byPair)) {
    bucket.count = bucket.comparisons.length;
    if (bucket.count > 0) {
      const sum = bucket.comparisons.reduce((s, c) => s + c.delta, 0);
      bucket.avgDelta = Math.round((sum / bucket.count) * 10) / 10;
      bucket.avgPctDelta = groupHvorpPctDelta(bucket.comparisons);
    }
  }

  const allDeltas = comparisons.map((c) => c.delta);
  const avgDeltaOverall = allDeltas.length
    ? Math.round((allDeltas.reduce((s, d) => s + d, 0) / allDeltas.length) * 10) / 10
    : null;
  const avgPctDeltaOverall = groupHvorpPctDelta(comparisons);

  return { byPair, avgDeltaOverall, avgPctDeltaOverall, totalComparisons: comparisons.length };
}

/**
 * Main entry: value-ranked players → cross-position HVORP comparison groups.
 *
 * @param {Object} params
 * @param {Array<{ name, position, value, playerId }>} params.players
 * @param {string[]} [params.baseRoster] — starter pool before adding compared players
 * @param {Array<Object>} params.playerWeeklyPoints — 17-week points maps
 * @param {Object} params.playersData
 * @param {Object} params.playerIdMap
 * @param {Object} params.playerSeasonTotalsMap
 * @param {number} [params.valueTolerance]
 * @param {number|string} [params.season] — echoed in output for multi-season runs
 */
export function computePosValueCompare({
  players,
  baseRoster = EMPTY_ROSTER,
  playerWeeklyPoints,
  playersData,
  playerIdMap,
  playerSeasonTotalsMap,
  valueTolerance = DEFAULT_VALUE_TOLERANCE,
  season = null,
  topKtcRank = TOP_KTC_RANK,
}) {
  const rankedPlayers = filterTopKtcPlayers(players, topKtcRank);
  const hvorpLookup = buildHvorpLookup(
    rankedPlayers,
    baseRoster,
    playerWeeklyPoints,
    playersData,
    playerIdMap,
    playerSeasonTotalsMap,
  );

  const playersWithHvorp = [...hvorpLookup.values()];
  const comparisons = findValueMatchedPairs(playersWithHvorp, valueTolerance);
  const { byPair, avgDeltaOverall, avgPctDeltaOverall, totalComparisons } = aggregateComparisons(comparisons);

  return {
    season,
    baseRosterSize: (baseRoster || []).length,
    playersEvaluated: playersWithHvorp.length,
    valueTolerance,
    comparisons,
    byPair,
    avgDeltaOverall,
    avgPctDeltaOverall,
    totalComparisons,
  };
}

export { pairKey, valuesMatch };
