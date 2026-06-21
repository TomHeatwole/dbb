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
import { buildSleeperBasePoints } from './sleeperScoring';

const NUM_WEEKS       = 17;
const REG_SEASON_END  = 14; // last regular season week (inclusive, 1-indexed → slice 0..14)
const PLAYOFF_START   = 15; // first playoff week (1-indexed → index 14)

/**
 * Build a flat playerWeeklyPoints lookup:
 *   playerWeeklyPoints[weekIndex][playerId] = points
 *
 * Strategy (in priority order):
 *   1. Sleeper base points calculated from raw weekly stats for ALL players —
 *      this covers free agents who were never on any roster.
 *   2. Authoritative matchup-sourced players_points for rostered players —
 *      Sleeper already applied the exact league scoring rules here, so we
 *      trust this over our own recalculation.
 *
 * Result: every player who played (rostered or not) has accurate fantasy points.
 *
 * @param {Array}       weeksParsedData      17-week matchup array from fetchScoresData.
 * @param {Array|null}  sleeperWeeklyStats   0-indexed array of { [pid]: rawStatsObj }.
 * @param {Object|null} scoringConfig        League scoring config (score_format.json).
 * @param {Object|null} playersData          Sleeper player metadata (for positions).
 */
function buildPlayerWeeklyPoints(weeksParsedData, sleeperWeeklyStats, scoringConfig, playersData) {
  // Layer 1: compute base points for all players from raw Sleeper weekly stats.
  // This initialises free-agent scores that the matchup data won't contain.
  const base = (sleeperWeeklyStats && scoringConfig)
    ? buildSleeperBasePoints(sleeperWeeklyStats, scoringConfig, playersData)
    : Array.from({ length: 17 }, () => ({}));

  // Layer 2: overlay the authoritative matchup-sourced points for rostered players.
  return (weeksParsedData || []).map((weekEntries, weekIdx) => {
    const weekPts = { ...base[weekIdx] };
    (weekEntries || []).forEach((entry) => {
      for (const [pid, pts] of Object.entries(entry?.players_points || {})) {
        weekPts[pid] = pts;
      }
    });
    return weekPts;
  });
}

/**
 * Run StartSitSort for a single team/week, treating the entire roster
 * as the candidate pool (no pre-set starters).
 */
export function computeOptimalWeek(playerList, weekPts, playersData, playerIdMap, playerSeasonTotalsMap) {
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
export function computeAllWeeklyScores(rosters, playerWeeklyPoints, playersData, playerIdMap, playerSeasonTotalsMap) {
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
export function computeRegSeasonTotals(weeklyScores) {
  const totals = {};
  for (const rid in weeklyScores) {
    totals[rid] = Math.round(
      (weeklyScores[rid] || []).slice(0, REG_SEASON_END).reduce((s, w) => s + (w.starterTotal || 0), 0) * 10,
    ) / 10;
  }
  return totals;
}

/** Sum starterTotal over weeks 15-17 (playoffs) for each roster. */
export function computePlayoffTotals(weeklyScores) {
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
 * @public Exported for reuse in computeFutureScenarioEval.
 *   - Seed top 4 by 14-week total
 *   - Rank top 4 by playoff total (weeks 15-17)
 *   - Rank bottom 6 by 14-week total
 *
 * @returns {Array<{ rosterId, place, isPlayoff, regSeasonTotal, playoffTotal }>}
 */
export function buildFinalStandings(regSeasonTotals, playoffTotals) {
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
 * @param {Array}       weeksParsedData     17-week array from fetchScoresData
 * @param {Object}      originalRosters     { [rosterId]: string[] }
 * @param {Object}      scenarioRosters     { [rosterId]: string[] }
 * @param {Object|null} playersData         Sleeper player metadata keyed by player ID
 * @param {Object|null} playerIdMap         Sleeper → ESPN ID map
 * @param {Array|null}  sleeperWeeklyStats  0-indexed array of raw Sleeper weekly stats
 *                                          (from weeklyStatsLoader.fetchMultipleWeeksStats).
 *                                          When provided, free-agent scores are computed
 *                                          from these raw stats via sleeperScoring.js.
 * @param {Object|null} scoringConfig       League scoring config (score_format.json).
 *                                          Required alongside sleeperWeeklyStats.
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
export function computeScenarioEval(weeksParsedData, originalRosters, scenarioRosters, playersData, playerIdMap, sleeperWeeklyStats = null, scoringConfig = null) {
  const playerWeeklyPoints    = buildPlayerWeeklyPoints(weeksParsedData, sleeperWeeklyStats, scoringConfig, playersData);
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

/**
 * Per-player season totals for a scenario roster: fantasy points, lineup usage,
 * and HVORP (starterTotal with player minus optimal starterTotal without them).
 */
export function computePlayerRosterStats(
  rosterId,
  rosterPlayerIds,
  scenarioWeeklyScores,
  playerWeeklyPoints,
  playersData,
  playerIdMap,
  playerSeasonTotalsMap,
) {
  const weeks = (scenarioWeeklyScores || {})[rosterId] || [];
  const playerList = (rosterPlayerIds || []).filter((pid) => pid && pid !== '0');
  const statsByPlayer = {};

  for (const pid of playerList) {
    statsByPlayer[pid] = {
      playerId: pid,
      totalScore: 0,
      weeksStarted: 0,
      weeksBenched: 0,
      hvorp: 0,
    };
  }

  for (let wi = 0; wi < NUM_WEEKS; wi++) {
    const weekData = weeks[wi] || {};
    const weekPts = playerWeeklyPoints[wi] || {};
    const withTotal = weekData.starterTotal || 0;

    const starterIds = new Set(
      (weekData.starters || []).map((p) => p.id).filter((id) => id && id !== '0'),
    );
    const benchIds = new Set(
      (weekData.bench || []).map((p) => p.id).filter((id) => id && id !== '0'),
    );

    for (const pid of playerList) {
      statsByPlayer[pid].totalScore += weekPts[pid] ?? 0;
      if (starterIds.has(pid)) {
        statsByPlayer[pid].weeksStarted += 1;
      } else if (benchIds.has(pid)) {
        statsByPlayer[pid].weeksBenched += 1;
      }
    }

    for (const pid of playerList) {
      const rosterWithout = playerList.filter((id) => id !== pid);
      const withoutOptimal = computeOptimalWeek(
        rosterWithout,
        weekPts,
        playersData,
        playerIdMap,
        playerSeasonTotalsMap,
      );
      const withoutTotal = withoutOptimal?.starterTotal || 0;
      statsByPlayer[pid].hvorp += withTotal - withoutTotal;
    }
  }

  return playerList
    .map((pid) => ({
      ...statsByPlayer[pid],
      totalScore: Math.round(statsByPlayer[pid].totalScore * 10) / 10,
      hvorp: Math.round(statsByPlayer[pid].hvorp * 10) / 10,
    }))
    .sort((a, b) => b.hvorp - a.hvorp);
}
