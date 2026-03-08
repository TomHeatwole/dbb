/**
 * computeFutureScenarioEval.js
 *
 * Core computation for the Future Scenarios feature.
 *
 * Unlike computeScenarioEval (which replays real historical matchup data),
 * this engine projects a full 17-week season forward by mapping each current
 * player's FantasyPros positional rank onto the player who achieved that rank
 * in a chosen historical season, then borrowing that historical player's actual
 * week-by-week stats.
 *
 * Rank mapping rules:
 *   • Current player is FP-ranked as, e.g., TE10
 *   • We find who finished 10th among TEs in the projection season by actual
 *     fantasy points (half-PPR for TE, standard for all others)
 *   • That historical player's weekly stats become the projection for the
 *     current player
 *
 * Players with no FP rank (K, DST, deep backups) project to 0 pts every week.
 * Historical rank slots beyond the FP list depth project to 0 pts.
 *
 * Returns the same shape as computeScenarioEval so all downstream display
 * components (ScenarioStandingsPanel, ScenarioTeamDetail, etc.) work unchanged.
 */

import { buildSleeperBasePoints } from './sleeperScoring';
import {
  computeAllWeeklyScores,
  computeRegSeasonTotals,
  computePlayoffTotals,
  buildFinalStandings,
} from './computeScenarioEval';

const NUM_WEEKS = 17;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sum projected weekly points over all weeks per player.
 * Used as a tiebreaker in StartSitSort (mirrors playerSeasonTotalsMap role).
 *
 * @param {Array<Object>} playerWeeklyPoints  17-element array of { [pid]: pts }.
 * @returns {Object}  { [playerId]: seasonTotal }
 */
function buildProjectedSeasonTotals(playerWeeklyPoints) {
  const totals = {};
  for (const weekPts of playerWeeklyPoints) {
    for (const [pid, pts] of Object.entries(weekPts || {})) {
      totals[pid] = (totals[pid] || 0) + pts;
    }
  }
  return totals;
}

// ── Core projection ───────────────────────────────────────────────────────────

/**
 * Build the playerWeeklyPoints lookup for a future projection.
 *
 * For each player across all provided rosters:
 *   1. Look up their FP rank + position.
 *   2. Find the Sleeper ID of the historical player at that positional rank.
 *   3. Copy that historical player's weekly points to the current player's ID.
 *
 * Players with no FP rank, or whose rank exceeds the historical list depth,
 * receive 0 points for every week.
 *
 * @param {Object}  allRosters            { [rosterId]: sleeperPlayerId[] }
 *   Should include the union of original + scenario roster players so that
 *   both sets are covered by a single pass.
 * @param {Object}  fpRankings            { [sleeperPlayerId]: { rank, position } }
 * @param {Object}  historicalPositionRanks  { QB: sid[], RB: sid[], WR: sid[], TE: sid[] }
 *   Each array is 0-indexed (index 0 = rank 1), sorted by descending season pts.
 * @param {Array<Object|null>}  historicalWeeklyStats
 *   17-element 0-indexed array of { [sleeperPlayerId]: rawSleeperStats }.
 * @param {Object}  scoringConfig         League scoring config (score_format.json).
 * @param {Object}  playersData           Sleeper players metadata keyed by player ID.
 * @returns {Array<Object>}  17-element array of { [currentSleeperPlayerId]: points }.
 */
export function buildFutureProjectionPoints(
  allRosters,
  fpRankings,
  historicalPositionRanks,
  historicalWeeklyStats,
  scoringConfig,
  playersData,
) {
  // Compute base points for every historical player in every week using their
  // raw Sleeper stats run through the league scoring config.
  const historicalBasePoints = buildSleeperBasePoints(
    historicalWeeklyStats,
    scoringConfig,
    playersData,
  );

  // Collect the set of all current player IDs we need to project.
  const allCurrentPlayerIds = new Set();
  for (const rid in allRosters) {
    for (const pid of (allRosters[rid] || [])) allCurrentPlayerIds.add(pid);
  }

  // Build the projection: for each current player, find their historical
  // equivalent and copy their weekly points.
  return Array.from({ length: NUM_WEEKS }, (_, weekIdx) => {
    const weekPts = {};

    for (const currentPid of allCurrentPlayerIds) {
      const fpInfo = fpRankings && fpRankings[currentPid];
      if (!fpInfo) {
        // No FP rank → 0 pts (K, DST, deep backups)
        weekPts[currentPid] = 0;
        continue;
      }

      const { rank, position } = fpInfo;
      const posRanks = historicalPositionRanks && historicalPositionRanks[position];

      if (!posRanks || posRanks.length === 0) {
        weekPts[currentPid] = 0;
        continue;
      }

      // rank is 1-based; array is 0-based.
      // Each entry is { sleeperId, scoringPts } (see historicalRankingsBuilder).
      const histIdx = rank - 1;
      if (histIdx >= posRanks.length) {
        weekPts[currentPid] = 0;
        continue;
      }

      const historicalSleeperId = posRanks[histIdx]?.sleeperId;
      if (!historicalSleeperId) {
        weekPts[currentPid] = 0;
        continue;
      }

      weekPts[currentPid] = historicalBasePoints[weekIdx]?.[historicalSleeperId] ?? 0;
    }

    return weekPts;
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run the full future scenario evaluation.
 *
 * Produces the same output shape as computeScenarioEval so all display
 * components can be reused without modification.
 *
 * @param {Object}  originalRosters        { [rosterId]: sleeperPlayerId[] }
 *   Current live rosters (unedited).
 * @param {Object}  scenarioRosters        { [rosterId]: sleeperPlayerId[] }
 *   Rosters after add/drop edits.
 * @param {Object}  fpRankings             { [sleeperPlayerId]: { rank, position } }
 * @param {Object}  historicalPositionRanks  { QB: sid[], RB: sid[], WR: sid[], TE: sid[] }
 * @param {Array<Object|null>}  historicalWeeklyStats
 *   17-element 0-indexed array of raw Sleeper stats for the projection season.
 * @param {Object}  scoringConfig          score_format.json contents.
 * @param {Object}  playersData            Sleeper players metadata.
 * @param {Object}  playerIdMap            Sleeper → ESPN ID map.
 * @returns {{
 *   originalWeeklyScores,
 *   scenarioWeeklyScores,
 *   originalStandings,
 *   scenarioStandings,
 *   teamDeltas,
 *   playerWeeklyPoints,
 * }}
 */
export function computeFutureScenarioEval(
  originalRosters,
  scenarioRosters,
  fpRankings,
  historicalPositionRanks,
  historicalWeeklyStats,
  scoringConfig,
  playersData,
  playerIdMap,
) {
  // Merge all player IDs so both original and scenario rosters are covered.
  const combinedRosters = {};
  const allRids = new Set([
    ...Object.keys(originalRosters || {}),
    ...Object.keys(scenarioRosters  || {}),
  ]);
  for (const rid of allRids) {
    const orig = originalRosters[rid] || [];
    const scen = scenarioRosters[rid]  || [];
    const merged = [...new Set([...orig, ...scen])];
    combinedRosters[rid] = merged;
  }

  const playerWeeklyPoints = buildFutureProjectionPoints(
    combinedRosters,
    fpRankings,
    historicalPositionRanks,
    historicalWeeklyStats,
    scoringConfig,
    playersData,
  );

  // Use projected season totals as the StartSitSort tiebreaker.
  const playerSeasonTotalsMap = buildProjectedSeasonTotals(playerWeeklyPoints);

  const originalWeeklyScores = computeAllWeeklyScores(
    originalRosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap,
  );
  const scenarioWeeklyScores = computeAllWeeklyScores(
    scenarioRosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap,
  );

  const originalRegTotals   = computeRegSeasonTotals(originalWeeklyScores);
  const originalPloffTotals = computePlayoffTotals(originalWeeklyScores);
  const scenarioRegTotals   = computeRegSeasonTotals(scenarioWeeklyScores);
  const scenarioPloffTotals = computePlayoffTotals(scenarioWeeklyScores);

  const originalStandings = buildFinalStandings(originalRegTotals, originalPloffTotals);
  const scenarioStandings = buildFinalStandings(scenarioRegTotals,  scenarioPloffTotals);

  const teamDeltas = Object.keys(originalRosters).map(Number).map((rid) => {
    const origRow   = originalStandings.find((r) => r.rosterId === rid) || {};
    const scenRow   = scenarioStandings.find((r)  => r.rosterId === rid) || {};
    return {
      rosterId:       rid,
      originalPlace:  origRow.place ?? null,
      regSeasonDelta: Math.round(((scenarioRegTotals[rid]   || 0) - (originalRegTotals[rid]   || 0)) * 10) / 10,
      playoffDelta:   Math.round(((scenarioPloffTotals[rid] || 0) - (originalPloffTotals[rid] || 0)) * 10) / 10,
      isPlayoff:      scenRow.isPlayoff || false,
    };
  });

  return {
    originalWeeklyScores,
    scenarioWeeklyScores,
    originalStandings,
    scenarioStandings,
    teamDeltas,
    playerWeeklyPoints,
  };
}
