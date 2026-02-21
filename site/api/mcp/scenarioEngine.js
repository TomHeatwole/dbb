/**
 * scenarioEngine.js
 *
 * Self-contained scenario computation engine for the MCP server.
 * Ports the core logic from computeScenarioEval.js + StartSitDecider.js
 * without any React dependencies.
 *
 * Computes optimal lineups for all teams across all 17 weeks, then
 * compares original vs modified rosters to produce standings deltas.
 *
 * Simplified vs the React version:
 *   - No injury/game-status logic (irrelevant for completed historical seasons)
 *   - No free-agent scoring layer (players not in any matchup score 0)
 *   - Position read directly from playersData, not through PlayerLookup/playerIdMap
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { STARTER_POSITION_NAMES, DATA_DIR } from './config.js';

const NUM_WEEKS      = 17;
const REG_SEASON_END = 14; // last regular season week (1-indexed, inclusive)
const PLAYOFF_START  = 15; // first playoff week (1-indexed)

// ── Scoring config ────────────────────────────────────────────────────────────

let scoreFormatCache = null;

function loadScoreFormat() {
  if (scoreFormatCache) return scoreFormatCache;
  try {
    const text = readFileSync(join(DATA_DIR, 'score_format.json'), 'utf8');
    scoreFormatCache = JSON.parse(text);
  } catch {
    scoreFormatCache = {};
  }
  return scoreFormatCache;
}

// ── Starter slot parsing ──────────────────────────────────────────────────────

function parseStarterCounts() {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER: 0 };
  for (const name of (STARTER_POSITION_NAMES || [])) {
    if (!name) continue;
    if (/^QB\d*$/i.test(name))            counts.QB   += 1;
    else if (/^RB\d*$/i.test(name))       counts.RB   += 1;
    else if (/^WR\d*$/i.test(name))       counts.WR   += 1;
    else if (/^TE\d*$/i.test(name))       counts.TE   += 1;
    else if (/^FLEX\d*$/i.test(name))     counts.FLEX += 1;
    else if (/^SUPER\d*$/i.test(name))    counts.SUPER += 1;
  }
  return counts;
}

function isEligibleForFlex(pos)  { return pos === 'RB' || pos === 'WR' || pos === 'TE'; }
function isEligibleForSuper(pos) { return pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE'; }

// ── Optimal lineup for one team/week ─────────────────────────────────────────

function computeOptimalWeek(playerIds, weekPts, playersData) {
  const counts = parseStarterCounts();

  // Build enriched player list with position and points
  const players = (playerIds || [])
    .filter(id => id && id !== '0')
    .map(id => ({
      id,
      pts: weekPts[id] ?? 0,
      position: playersData[id]?.position || null,
    }));

  // Sort by pts descending, then by id for stability
  const byPts = (a, b) => b.pts !== a.pts ? b.pts - a.pts : String(a.id).localeCompare(String(b.id));

  const used = new Set();

  function takeTop(list, n) {
    const taken = [];
    for (const p of list.slice().sort(byPts)) {
      if (taken.length >= n) break;
      if (!used.has(p.id)) { taken.push(p); used.add(p.id); }
    }
    return taken;
  }

  // Fill fixed position slots
  const qbs   = players.filter(p => p.position === 'QB');
  const rbs   = players.filter(p => p.position === 'RB');
  const wrs   = players.filter(p => p.position === 'WR');
  const tes   = players.filter(p => p.position === 'TE');

  const starters = [
    ...takeTop(qbs,  counts.QB),
    ...takeTop(rbs,  counts.RB),
    ...takeTop(wrs,  counts.WR),
    ...takeTop(tes,  counts.TE),
  ];

  // FLEX slots (RB/WR/TE)
  const flexPool = players.filter(p => !used.has(p.id) && isEligibleForFlex(p.position));
  starters.push(...takeTop(flexPool, counts.FLEX));

  // SUPER slots (QB/RB/WR/TE) — refetch remaining after FLEX
  const superPool = players.filter(p => !used.has(p.id) && isEligibleForSuper(p.position));
  starters.push(...takeTop(superPool, counts.SUPER));

  const starterTotal = Math.round(starters.reduce((s, p) => s + p.pts, 0) * 100) / 100;
  return starterTotal;
}

// ── Build playerWeeklyPoints from raw matchup data ───────────────────────────
// weeksParsedData[weekIndex] = array of matchup entries, each with players_points

function buildPlayerWeeklyPoints(weeksParsedData) {
  return (weeksParsedData || []).map(weekEntries => {
    const weekPts = {};
    for (const entry of (weekEntries || [])) {
      for (const [pid, pts] of Object.entries(entry?.players_points || {})) {
        weekPts[pid] = pts;
      }
    }
    return weekPts;
  });
}

// ── Compute all weekly scores for all rosters ─────────────────────────────────

function computeAllWeeklyScores(rosters, playerWeeklyPoints, playersData) {
  const result = {};
  for (const [rid, playerIds] of Object.entries(rosters)) {
    result[rid] = [];
    for (let wi = 0; wi < NUM_WEEKS; wi++) {
      const weekPts = playerWeeklyPoints[wi] || {};
      result[rid].push(computeOptimalWeek(playerIds, weekPts, playersData));
    }
  }
  return result;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function computeRegSeasonTotals(weeklyScores) {
  const totals = {};
  for (const [rid, weeks] of Object.entries(weeklyScores)) {
    totals[rid] = Math.round(
      weeks.slice(0, REG_SEASON_END).reduce((s, pts) => s + pts, 0) * 10
    ) / 10;
  }
  return totals;
}

function computePlayoffTotals(weeklyScores) {
  const totals = {};
  for (const [rid, weeks] of Object.entries(weeklyScores)) {
    totals[rid] = Math.round(
      weeks.slice(PLAYOFF_START - 1).reduce((s, pts) => s + pts, 0) * 10
    ) / 10;
  }
  return totals;
}

function buildFinalStandings(regSeasonTotals, playoffTotals) {
  const all = Object.keys(regSeasonTotals).map(rid => ({
    rosterId:       Number(rid),
    regSeasonTotal: regSeasonTotals[rid] || 0,
    playoffTotal:   playoffTotals[rid]   || 0,
  }));

  const byRegSeason = all.slice().sort((a, b) => b.regSeasonTotal - a.regSeasonTotal);

  const top4 = byRegSeason.slice(0, 4)
    .sort((a, b) => b.playoffTotal - a.playoffTotal)
    .map((row, i) => ({ ...row, place: i + 1, isPlayoff: true }));

  const bottom = byRegSeason.slice(4)
    .map((row, i) => ({ ...row, place: 5 + i, isPlayoff: false }));

  return [...top4, ...bottom];
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a scenario evaluation.
 *
 * @param {Array}  weeksParsedData  17-element array of raw Sleeper matchup entries (from fetchAllWeekScores)
 * @param {Object} originalRosters  { [rosterId]: string[] }  player IDs per team
 * @param {Object} scenarioRosters  { [rosterId]: string[] }  modified player IDs per team
 * @param {Object} playersData      Sleeper players keyed by player ID
 * @returns {{ originalStandings, scenarioStandings, teamDeltas }}
 */
export function runScenarioEval(weeksParsedData, originalRosters, scenarioRosters, playersData) {
  const playerWeeklyPoints   = buildPlayerWeeklyPoints(weeksParsedData);

  const origScores  = computeAllWeeklyScores(originalRosters, playerWeeklyPoints, playersData);
  const scenScores  = computeAllWeeklyScores(scenarioRosters, playerWeeklyPoints, playersData);

  const origReg     = computeRegSeasonTotals(origScores);
  const origPloff   = computePlayoffTotals(origScores);
  const scenReg     = computeRegSeasonTotals(scenScores);
  const scenPloff   = computePlayoffTotals(scenScores);

  const originalStandings = buildFinalStandings(origReg, origPloff);
  const scenarioStandings = buildFinalStandings(scenReg, scenPloff);

  const teamDeltas = Object.keys(originalRosters).map(Number).map(rid => {
    const orig = originalStandings.find(r => r.rosterId === rid) || {};
    const scen = scenarioStandings.find(r => r.rosterId === rid)  || {};
    return {
      rosterId:        rid,
      originalPlace:   orig.place ?? null,
      scenarioPlace:   scen.place ?? null,
      placeDelta:      orig.place != null && scen.place != null ? orig.place - scen.place : 0,
      regSeasonDelta:  Math.round(((scenReg[rid]  || 0) - (origReg[rid]  || 0)) * 10) / 10,
      playoffDelta:    Math.round(((scenPloff[rid] || 0) - (origPloff[rid] || 0)) * 10) / 10,
      origIsPlayoff:   orig.isPlayoff || false,
      scenIsPlayoff:   scen.isPlayoff || false,
    };
  });

  return { originalStandings, scenarioStandings, teamDeltas };
}
