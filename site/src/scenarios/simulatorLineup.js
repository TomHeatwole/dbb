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

function slotBucketForName(name) {
  if (/^QB\d+$/i.test(name) || name === 'QB1') return 'QB';
  if (/^RB\d+$/i.test(name)) return 'RB';
  if (/^WR\d+$/i.test(name)) return 'WR';
  if (/^TE\d+$/i.test(name) || name === 'TE1') return 'TE';
  if (/^SUPER$/i.test(name) || /^SUPER\d+$/i.test(name)) return 'SUPER';
  if (/^FLEX\d+$/i.test(name)) return 'FLEX';
  return null;
}

/**
 * Optimal starters for one team/week — points per STARTER_POSITION_NAMES slot.
 *
 * @returns {number[]}
 */
export function computeOptimalWeekStarters(playerList, weekPts, playerPositions, seasonTotals) {
  const slotNames = STARTER_POSITION_NAMES || [];
  const empty = () => new Array(slotNames.length).fill(0);

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
  if (combined.length === 0) return empty();

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

  const selectedQB = [];
  const selectedRB = [];
  const selectedWR = [];
  const selectedTE = [];
  const selectedFLEX = [];
  const selectedSUPER = [];

  function takeTop(list, n, bucket) {
    let taken = 0;
    for (let i = 0; i < list.length && taken < n; i++) {
      const p = list[i];
      if (usedIds.has(p.id)) continue;
      usedIds.add(p.id);
      bucket.push(p);
      taken += 1;
    }
  }

  takeTop(qbs, counts.QB, selectedQB);
  takeTop(rbs, counts.RB, selectedRB);
  takeTop(wrs, counts.WR, selectedWR);
  takeTop(tes, counts.TE, selectedTE);

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
      selectedFLEX.push(p);
      flexLeft -= 1;
    }
  }

  if (counts.SUPER > 0) {
    let superLeft = counts.SUPER;
    for (let i = 0; i < combined.length && superLeft > 0; i++) {
      const p = combined[i];
      if (usedIds.has(p.id) || !isEligibleForSuper(p.position)) continue;
      usedIds.add(p.id);
      selectedSUPER.push(p);
      superLeft -= 1;
    }
  }

  const buckets = {
    QB: sortByPointsDesc([...selectedQB], seasonTotals),
    RB: sortByPointsDesc([...selectedRB], seasonTotals),
    WR: sortByPointsDesc([...selectedWR], seasonTotals),
    TE: sortByPointsDesc([...selectedTE], seasonTotals),
    FLEX: sortByPointsDesc([...selectedFLEX], seasonTotals),
    SUPER: sortByPointsDesc([...selectedSUPER], seasonTotals),
  };

  const consumed = new Set();
  function popNext(bucketName) {
    const list = buckets[bucketName] || [];
    while (list.length > 0) {
      const p = list.shift();
      if (!consumed.has(p.id)) {
        consumed.add(p.id);
        return p;
      }
    }
    return null;
  }

  const slotPts = new Array(slotNames.length).fill(0);
  for (let i = 0; i < slotNames.length; i++) {
    const bucketName = slotBucketForName(slotNames[i]);
    const p = bucketName ? popNext(bucketName) : null;
    slotPts[i] = p ? p.pts : 0;
  }

  return slotPts;
}

/**
 * Optimal starter total for one team/week.
 */
export function computeOptimalWeekStarterTotal(playerList, weekPts, playerPositions, seasonTotals) {
  const slotPts = computeOptimalWeekStarters(playerList, weekPts, playerPositions, seasonTotals);
  let total = 0;
  for (let i = 0; i < slotPts.length; i++) total += slotPts[i];
  return total;
}

/**
 * Score all rosters in one pass — reg + playoff totals and per-slot season sums.
 */
export function scoreAllRostersFast(rosters, weekBuffers, playerPositions, seasonTotals) {
  const regTotals = {};
  const ploffTotals = {};
  const slotReg = {};
  const slotPloff = {};
  const numSlots = (STARTER_POSITION_NAMES || []).length;

  for (const rid in rosters) {
    const playerList = rosters[rid] || [];
    let reg = 0;
    let ploff = 0;
    const regSlots = new Float32Array(numSlots);
    const ploffSlots = new Float32Array(numSlots);

    for (let wi = 0; wi < NUM_WEEKS; wi++) {
      const slotPts = computeOptimalWeekStarters(
        playerList,
        weekBuffers[wi],
        playerPositions,
        seasonTotals,
      );
      let weekTotal = 0;
      for (let si = 0; si < numSlots; si++) {
        weekTotal += slotPts[si];
        if (wi < REG_SEASON_WEEKS) regSlots[si] += slotPts[si];
        else ploffSlots[si] += slotPts[si];
      }
      if (wi < REG_SEASON_WEEKS) reg += weekTotal;
      else ploff += weekTotal;
    }

    regTotals[rid] = Math.round(reg * 10) / 10;
    ploffTotals[rid] = Math.round(ploff * 10) / 10;
    slotReg[rid] = Array.from(regSlots, (v) => Math.round(v * 10) / 10);
    slotPloff[rid] = Array.from(ploffSlots, (v) => Math.round(v * 10) / 10);
  }

  return { regTotals, ploffTotals, slotReg, slotPloff };
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
