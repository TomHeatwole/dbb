/**
 * simulatorLineup.js
 *
 * Fast optimal-lineup scoring for Monte Carlo sims. Skips injury/BYE/game-status
 * tiebreakers (always null in projections) and returns starter totals only.
 */

import { STARTER_POSITION_NAMES } from '../utils/global_constants';

const NUM_WEEKS = 17;
export const REG_SEASON_WEEKS = 14;

let positionCountsCache = null;

function getPositionCounts() {
  if (positionCountsCache) return positionCountsCache;
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER: 0 };
  (STARTER_POSITION_NAMES || []).forEach((name) => {
    if (!name) return;
    if (/^QB\d+$/i.test(name) || name === 'QB1') { counts.QB += 1; return; }
    if (/^RB\d+$/i.test(name)) { counts.RB += 1; return; }
    if (/^WR\d+$/i.test(name)) { counts.WR += 1; return; }
    if (/^TE\d+$/i.test(name) || name === 'TE1') { counts.TE += 1; return; }
    if (/^FLEX\d+$/i.test(name)) { counts.FLEX += 1; return; }
    if (/^SUPER$/i.test(name) || /^SUPER\d+$/i.test(name)) { counts.SUPER += 1; }
  });
  positionCountsCache = counts;
  return counts;
}

function isEligibleForSuper(pos) {
  return pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE';
}

function isEligibleForFlex(pos) {
  return pos === 'RB' || pos === 'WR' || pos === 'TE';
}

/** Sort by pts desc, then season-total tiebreaker, then stable id. */
function sortByPointsDesc(players, seasonTotals) {
  return players.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (seasonTotals) {
      const aTot = seasonTotals[a.id] || 0;
      const bTot = seasonTotals[b.id] || 0;
      if (bTot !== aTot) return bTot - aTot;
    }
    const aId = String(a.id);
    const bId = String(b.id);
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
}

/**
 * Optimal starter total for one team/week.
 *
 * @param {string[]} playerList
 * @param {Object} weekPts  { [playerId]: number }
 * @param {Object} playerPositions  { [playerId]: string|null }
 * @param {Object} seasonTotals  { [playerId]: number }
 */
export function computeOptimalWeekStarterTotal(playerList, weekPts, playerPositions, seasonTotals) {
  const combined = [];
  for (let i = 0; i < playerList.length; i++) {
    const id = playerList[i];
    if (!id || id === '0') continue;
    combined.push({
      id,
      pts: weekPts[id] ?? 0,
      position: playerPositions[id] || null,
    });
  }
  if (combined.length === 0) return 0;

  const counts = getPositionCounts();
  const usedIds = new Set();

  const qbs = [];
  const rbs = [];
  const wrs = [];
  const tes = [];
  for (let i = 0; i < combined.length; i++) {
    const p = combined[i];
    if (p.position === 'QB') qbs.push(p);
    else if (p.position === 'RB') rbs.push(p);
    else if (p.position === 'WR') wrs.push(p);
    else if (p.position === 'TE') tes.push(p);
  }

  sortByPointsDesc(qbs, seasonTotals);
  sortByPointsDesc(rbs, seasonTotals);
  sortByPointsDesc(wrs, seasonTotals);
  sortByPointsDesc(tes, seasonTotals);

  let starterTotal = 0;

  function takeTop(list, n) {
    let taken = 0;
    for (let i = 0; i < list.length && taken < n; i++) {
      const p = list[i];
      if (usedIds.has(p.id)) continue;
      usedIds.add(p.id);
      starterTotal += p.pts;
      taken += 1;
    }
  }

  takeTop(qbs, counts.QB);
  takeTop(rbs, counts.RB);
  takeTop(wrs, counts.WR);
  takeTop(tes, counts.TE);

  const remaining = [];
  for (let i = 0; i < combined.length; i++) {
    const p = combined[i];
    if (!usedIds.has(p.id)) remaining.push(p);
  }
  sortByPointsDesc(remaining, seasonTotals);

  if (counts.FLEX > 0) {
    let flexLeft = counts.FLEX;
    for (let i = 0; i < remaining.length && flexLeft > 0; i++) {
      const p = remaining[i];
      if (usedIds.has(p.id) || !isEligibleForFlex(p.position)) continue;
      usedIds.add(p.id);
      starterTotal += p.pts;
      flexLeft -= 1;
    }
  }

  if (counts.SUPER > 0) {
    let superLeft = counts.SUPER;
    for (let i = 0; i < combined.length && superLeft > 0; i++) {
      const p = combined[i];
      if (usedIds.has(p.id) || !isEligibleForSuper(p.position)) continue;
      usedIds.add(p.id);
      starterTotal += p.pts;
      superLeft -= 1;
    }
  }

  return starterTotal;
}

/**
 * Score all rosters in one pass — reg + playoff totals without storing weekly breakdowns.
 */
export function scoreAllRostersFast(rosters, weekBuffers, playerPositions, seasonTotals) {
  const regTotals = {};
  const ploffTotals = {};

  for (const rid in rosters) {
    const playerList = rosters[rid] || [];
    let reg = 0;
    let ploff = 0;
    for (let wi = 0; wi < NUM_WEEKS; wi++) {
      const starterTotal = computeOptimalWeekStarterTotal(
        playerList,
        weekBuffers[wi],
        playerPositions,
        seasonTotals,
      );
      if (wi < REG_SEASON_WEEKS) reg += starterTotal;
      else ploff += starterTotal;
    }
    regTotals[rid] = Math.round(reg * 10) / 10;
    ploffTotals[rid] = Math.round(ploff * 10) / 10;
  }

  return { regTotals, ploffTotals };
}

/**
 * Build { [playerId]: position } for roster players only.
 */
export function buildPlayerPositionsMap(playerIds, playersData) {
  const map = {};
  for (const pid of playerIds) {
    map[pid] = playersData?.[pid]?.position || null;
  }
  return map;
}
