/**
 * scenarioEngine.js
 *
 * Pure computation layer for MCP scenario evaluation.
 * Mirrors the logic of computeScenarioEval.js in the React app.
 *
 * Key design choice vs the React app:
 *   Instead of fetching all-player raw Sleeper weekly stats (expensive, 17 calls),
 *   we build a globalWeeklyPoints map by merging players_points from every team's
 *   matchup entry.  This covers any player who was ever on a roster during the season,
 *   which is sufficient for trade-reversal scenarios (both traded players were rostered).
 *   Free agents who were NEVER rostered will show 0 pts — noted in results.
 *
 * Standings logic mirrors the real site:
 *   - Seeds 1-4: top 14-week reg-season totals (optimal lineups, not actual)
 *   - Final 1-4 rank: playoff totals (weeks 15-17)
 *   - Places 5-10: reg-season totals
 */

import { STARTER_POSITION_NAMES } from './config.js';

const REG_SEASON_WEEKS = 14;

// ─── Position slot parser ─────────────────────────────────────────────────────

/**
 * Parse STARTER_POSITION_NAMES into slot counts.
 * e.g. ["QB1","RB1","RB2","RB3","WR1","WR2","WR3","TE1","FLEX1","FLEX2","SUPER"]
 *   → { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 2, SUPER: 1 }
 */
function parsePositionCounts(posNames) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, FLEX: 0, SUPER: 0 };
  for (const name of (posNames || [])) {
    if (!name) continue;
    const u = name.toUpperCase();
    if (u.startsWith('QB'))    counts.QB++;
    else if (u.startsWith('RB'))    counts.RB++;
    else if (u.startsWith('WR'))    counts.WR++;
    else if (u.startsWith('TE'))    counts.TE++;
    else if (u.startsWith('K'))     counts.K++;
    else if (u.startsWith('FLEX'))  counts.FLEX++;
    else if (u.startsWith('SUPER')) counts.SUPER++;
  }
  return counts;
}

const POSITION_COUNTS = parsePositionCounts(STARTER_POSITION_NAMES);

// ─── Global weekly points ─────────────────────────────────────────────────────

/**
 * Merge players_points from all teams across all weeks into a single lookup.
 *   globalWeeklyPoints[weekIndex][playerId] = points
 *
 * This covers every player who appeared on any roster during the season.
 * Free agents (never rostered) will be absent and treated as 0 pts.
 */
export function buildGlobalWeeklyPoints(weeksData) {
  return (weeksData || []).map((weekArr) => {
    const pts = {};
    if (!weekArr) return pts;
    for (const entry of weekArr) {
      for (const [pid, p] of Object.entries(entry?.players_points || {})) {
        pts[pid] = p;
      }
    }
    return pts;
  });
}

// ─── Optimal lineup calculator ────────────────────────────────────────────────

/**
 * Compute the best possible weekly score for a roster given actual weekly points.
 *
 * Greedy slot-fill (correct for standard dynasty lineup structures):
 *   1. Fill mandatory slots (QB → RB → WR → TE → K) with best scorer per position.
 *   2. Fill FLEX slots (RB/WR/TE eligible) with best remaining.
 *   3. Fill SUPER slots (QB/RB/WR/TE eligible) with best remaining.
 *
 * @param {string[]} playerList  Array of Sleeper player IDs on the roster.
 * @param {Object}   weekPts     { [playerId]: points } for this week.
 * @param {Object}   playersData Sleeper player metadata keyed by player ID.
 * @returns {{ starterTotal: number, starterIds: string[] }}
 */
function computeOptimalLineup(playerList, weekPts, playersData) {
  const sorted = (playerList || [])
    .map((id) => ({ id, pts: weekPts[id] ?? 0, pos: playersData[id]?.position || 'UNK' }))
    .sort((a, b) => b.pts - a.pts);

  const starters = [];
  const used = new Set();

  // Mandatory positional slots
  const mandatory = [
    ['QB',  POSITION_COUNTS.QB],
    ['RB',  POSITION_COUNTS.RB],
    ['WR',  POSITION_COUNTS.WR],
    ['TE',  POSITION_COUNTS.TE],
    ['K',   POSITION_COUNTS.K],
  ];
  for (const [pos, count] of mandatory) {
    let filled = 0;
    for (const p of sorted) {
      if (filled >= count) break;
      if (!used.has(p.id) && p.pos === pos) {
        starters.push(p);
        used.add(p.id);
        filled++;
      }
    }
  }

  // FLEX slots (RB / WR / TE)
  const flexEligible = new Set(['RB', 'WR', 'TE']);
  for (let i = 0; i < POSITION_COUNTS.FLEX; i++) {
    for (const p of sorted) {
      if (!used.has(p.id) && flexEligible.has(p.pos)) {
        starters.push(p);
        used.add(p.id);
        break;
      }
    }
  }

  // SUPER / Superflex slots (QB / RB / WR / TE)
  const superEligible = new Set(['QB', 'RB', 'WR', 'TE']);
  for (let i = 0; i < POSITION_COUNTS.SUPER; i++) {
    for (const p of sorted) {
      if (!used.has(p.id) && superEligible.has(p.pos)) {
        starters.push(p);
        used.add(p.id);
        break;
      }
    }
  }

  const starterTotal = starters.reduce((s, p) => s + p.pts, 0);
  return {
    starterTotal: Math.round(starterTotal * 10) / 10,
    starterIds: starters.map((p) => p.id),
  };
}

// ─── Season aggregation ───────────────────────────────────────────────────────

function computeAllWeeklyScores(rosters, globalWeeklyPoints, playersData) {
  const result = {};
  for (const rid in rosters) {
    result[rid] = (globalWeeklyPoints || []).map((weekPts) =>
      computeOptimalLineup(rosters[rid], weekPts, playersData)
    );
  }
  return result;
}

function sumWeeks(weeklyScores, rosterId, fromIdx, toIdx) {
  return Math.round(
    (weeklyScores[rosterId] || [])
      .slice(fromIdx, toIdx)
      .reduce((s, w) => s + (w.starterTotal || 0), 0) * 10
  ) / 10;
}

function buildFinalStandings(regTotals, ploffTotals) {
  const all = Object.keys(regTotals).map((rid) => ({
    rosterId:       Number(rid),
    regSeasonTotal: regTotals[rid]  || 0,
    playoffTotal:   ploffTotals[rid] || 0,
  }));

  const byReg = all.slice().sort((a, b) => b.regSeasonTotal - a.regSeasonTotal);

  const top4 = byReg.slice(0, 4)
    .sort((a, b) => b.playoffTotal - a.playoffTotal)
    .map((row, i) => ({ ...row, place: i + 1, isPlayoff: true }));

  const bottom6 = byReg
    .slice(4)
    .map((row, i) => ({ ...row, place: 5 + i, isPlayoff: false }));

  return [...top4, ...bottom6];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run a scenario evaluation for a single season.
 *
 * @param {Array}  weeksData        17-week matchup array (0-indexed) from fetchAllWeekScores.
 * @param {Object} originalRosters  { [rosterId: string]: string[] }
 * @param {Object} scenarioRosters  { [rosterId: string]: string[] }
 * @param {Object} playersData      Sleeper player metadata.
 *
 * @returns {{
 *   originalStandings: Array,
 *   scenarioStandings:  Array,
 *   origRegTotals:  Object,
 *   scenRegTotals:  Object,
 *   origPloffTotals: Object,
 *   scenPloffTotals: Object,
 * }}
 */
export function runScenario(weeksData, originalRosters, scenarioRosters, playersData) {
  const globalWeeklyPoints = buildGlobalWeeklyPoints(weeksData);

  const origScores = computeAllWeeklyScores(originalRosters, globalWeeklyPoints, playersData);
  const scenScores = computeAllWeeklyScores(scenarioRosters, globalWeeklyPoints, playersData);

  const origRegTotals   = {};
  const origPloffTotals = {};
  const scenRegTotals   = {};
  const scenPloffTotals = {};

  for (const rid of Object.keys(originalRosters)) {
    origRegTotals[rid]   = sumWeeks(origScores, rid, 0,                REG_SEASON_WEEKS);
    origPloffTotals[rid] = sumWeeks(origScores, rid, REG_SEASON_WEEKS, 17);
    scenRegTotals[rid]   = sumWeeks(scenScores, rid, 0,                REG_SEASON_WEEKS);
    scenPloffTotals[rid] = sumWeeks(scenScores, rid, REG_SEASON_WEEKS, 17);
  }

  const originalStandings = buildFinalStandings(origRegTotals, origPloffTotals);
  const scenarioStandings  = buildFinalStandings(scenRegTotals, scenPloffTotals);

  return {
    originalStandings,
    scenarioStandings,
    origRegTotals,
    scenRegTotals,
    origPloffTotals,
    scenPloffTotals,
  };
}
