/**
 * computeScenarioEval.js
 *
 * Core computation for the Scenario Evaluation feature.
 *
 * For every team, for every week, we compute the OPTIMAL lineup
 * (via StartSitSort) for both the original roster and the modified
 * scenario roster, then aggregate into standings and deltas.
 *
 * The comparison is always optimal vs optimal — this isolates the
 * roster change itself from manager lineup decisions.
 *
 * Standings logic mirrors the actual standings page:
 *   - Top 4 seeds determined by 14-week regular season totals
 *   - Top 4 final ranking by playoff totals (weeks 15-17)
 *   - Bottom 6 ranked by 14-week totals
 */

import { StartSitSort } from '../players/StartSitDecider';
import { getPlayerSeasonTotalsMap } from '../scores/ScoresParser';

const NUM_WEEKS       = 17;
const REG_SEASON_END  = 14; // last regular season week (inclusive, 1-indexed → slice 0..14)
const PLAYOFF_START   = 15; // first playoff week (1-indexed → index 14)

/**
 * Invert all per-team players_points into a single flat lookup.
 *
 * playerWeeklyPoints[weekIndex][playerId] = points
 *
 * Players on any roster in any given week will be present. Players
 * who were never on any roster that week resolve to 0.
 */
function buildPlayerWeeklyPoints(weeksParsedData) {
  return (weeksParsedData || []).map((weekEntries) =>
    (weekEntries || []).reduce((acc, entry) => {
      for (const [pid, pts] of Object.entries(entry?.players_points || {})) {
        acc[pid] = pts;
      }
      return acc;
    }, {}),
  );
}

/**
 * Run StartSitSort for a single team/week, treating the entire roster
 * as the candidate pool (no pre-set starters).
 */
function computeOptimalWeek(playerList, weekPts, playersData, playerIdMap, playerSeasonTotalsMap) {
  const teamScore = {
    starters: [],
    bench: (playerList || []).map((id) => ({ id, pts: weekPts[id] ?? 0 })),
  };
  return StartSitSort(teamScore, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
}

/**
 * Compute optimal weekly scores for every roster across all 17 weeks.
 *
 * @returns {{ [rosterId]: Array<{ starterTotal, benchTotal, starters, bench }> }}
 *   Index 0 = week 1, index 16 = week 17.
 */
function computeAllWeeklyScores(rosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap) {
  const result = {};
  for (const rid in rosters) {
    const playerList = rosters[rid] || [];
    result[rid] = [];
    for (let wi = 0; wi < NUM_WEEKS; wi++) {
      const weekPts = playerWeeklyPoints[wi] || {};
      const optimal = computeOptimalWeek(playerList, weekPts, playersData, playerIdMap, playerSeasonTotalsMap);
      result[rid].push(
        optimal
          ? { starterTotal: optimal.starterTotal, benchTotal: optimal.benchTotal, starters: optimal.starters, bench: optimal.bench }
          : { starterTotal: 0, benchTotal: 0, starters: [], bench: [] },
      );
    }
  }
  return result;
}

/** Sum starterTotal over weeks 1-14 (regular season) for each roster. */
function computeRegSeasonTotals(weeklyScores) {
  const totals = {};
  for (const rid in weeklyScores) {
    totals[rid] = Math.round(
      (weeklyScores[rid] || []).slice(0, REG_SEASON_END).reduce((s, w) => s + (w.starterTotal || 0), 0) * 10,
    ) / 10;
  }
  return totals;
}

/** Sum starterTotal over weeks 15-17 (playoffs) for each roster. */
function computePlayoffTotals(weeklyScores) {
  const totals = {};
  for (const rid in weeklyScores) {
    totals[rid] = Math.round(
      (weeklyScores[rid] || []).slice(PLAYOFF_START - 1).reduce((s, w) => s + (w.starterTotal || 0), 0) * 10,
    ) / 10;
  }
  return totals;
}

/**
 * Build final standings matching the real standings page logic:
 *   - Seed top 4 by 14-week total
 *   - Rank top 4 by playoff total (weeks 15-17)
 *   - Rank bottom 6 by 14-week total
 *
 * @returns {Array<{ rosterId, place, isPlayoff, regSeasonTotal, playoffTotal }>}
 */
function buildFinalStandings(regSeasonTotals, playoffTotals) {
  const all = Object.keys(regSeasonTotals).map((rid) => ({
    rosterId:      Number(rid),
    regSeasonTotal: regSeasonTotals[rid] || 0,
    playoffTotal:   playoffTotals[rid]   || 0,
  }));

  // Seed order: best 14-week total wins a playoff spot
  const byRegSeason = all.slice().sort((a, b) => b.regSeasonTotal - a.regSeasonTotal);

  // Top 4: ranked by playoff total
  const top4 = byRegSeason.slice(0, 4)
    .sort((a, b) => b.playoffTotal - a.playoffTotal)
    .map((row, i) => ({ ...row, place: i + 1, isPlayoff: true }));

  // Bottom 6: ranked by reg season total (already sorted)
  const bottom6 = byRegSeason.slice(4)
    .map((row, i) => ({ ...row, place: 5 + i, isPlayoff: false }));

  return [...top4, ...bottom6];
}

/**
 * Main entry point.
 *
 * @param {Array}       weeksParsedData   17-week array from fetchScoresData
 * @param {Object}      originalRosters   { [rosterId]: string[] }
 * @param {Object}      scenarioRosters   { [rosterId]: string[] }
 * @param {Object|null} playersData       Sleeper player metadata keyed by player ID
 * @param {Object|null} playerIdMap       Sleeper → ESPN ID map
 *
 * @returns {{
 *   originalWeeklyScores:  Object,
 *   scenarioWeeklyScores:  Object,
 *   originalStandings:     Array,
 *   scenarioStandings:     Array,
 *   teamDeltas:            Array,
 *   playerWeeklyPoints:    Array,
 * }}
 */
export function computeScenarioEval(weeksParsedData, originalRosters, scenarioRosters, playersData, playerIdMap) {
  const playerWeeklyPoints    = buildPlayerWeeklyPoints(weeksParsedData);
  const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksParsedData);

  const originalWeeklyScores = computeAllWeeklyScores(originalRosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap);
  const scenarioWeeklyScores = computeAllWeeklyScores(scenarioRosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap);

  const originalRegTotals  = computeRegSeasonTotals(originalWeeklyScores);
  const originalPloffTotals = computePlayoffTotals(originalWeeklyScores);
  const scenarioRegTotals  = computeRegSeasonTotals(scenarioWeeklyScores);
  const scenarioPloffTotals = computePlayoffTotals(scenarioWeeklyScores);

  const originalStandings = buildFinalStandings(originalRegTotals, originalPloffTotals);
  const scenarioStandings  = buildFinalStandings(scenarioRegTotals, scenarioPloffTotals);

  // Build original place lookup for delta calculation
  const originalPlaceByRosterId = {};
  for (const row of originalStandings) originalPlaceByRosterId[row.rosterId] = row.place;

  const teamDeltas = Object.keys(originalRosters).map(Number).map((rid) => {
    const origRow   = originalStandings.find((r) => r.rosterId === rid) || {};
    const scenRow   = scenarioStandings.find((r)  => r.rosterId === rid) || {};
    const isPlayoff = scenRow.isPlayoff || false;

    return {
      rosterId:       rid,
      originalPlace:  origRow.place ?? null,
      // Delta in the scoring column that governs their ranking
      regSeasonDelta: Math.round(((scenarioRegTotals[rid] || 0) - (originalRegTotals[rid] || 0)) * 10) / 10,
      playoffDelta:   Math.round(((scenarioPloffTotals[rid] || 0) - (originalPloffTotals[rid] || 0)) * 10) / 10,
      isPlayoff,
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
