// StartSitDecider.js
// Builds an optimal lineup from a team's weekly players list, ignoring provided starter/bench flags

import { STARTER_POSITION_NAMES } from './global_constants';
import { getPlayerInfo } from './PlayerLookup';

// Helper: sort descending by pts, then by started (started > not started when equal pts), then stable id
function buildSorter(playerGameLabels) {
  return function sortByGameAware(players) {
    return players.slice().sort((a, b) => {
      if (b.pts !== a.pts) { return b.pts - a.pts; }
      const aLab = playerGameLabels && playerGameLabels[a.id];
      const bLab = playerGameLabels && playerGameLabels[b.id];
      const aStarted = !!(aLab && (aLab.live || aLab.completed));
      const bStarted = !!(bLab && (bLab.live || bLab.completed));
      if (aStarted !== bStarted) { return bStarted ? 1 : -1; }
      const aId = String(a.id || '');
      const bId = String(b.id || '');
      if (aId < bId) { return -1; }
      if (aId > bId) { return 1; }
      return 0;
    });
  };
}

// Helper: build a map of position name -> count from STARTER_POSITION_NAMES
function getPositionCountsFromConfig() {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER: 0 };
  (STARTER_POSITION_NAMES || []).forEach((name) => {
    if (!name) { return; }
    if (/^QB\d+$/i.test(name) || name === 'QB1') { counts.QB += 1; return; }
    if (/^RB\d+$/i.test(name)) { counts.RB += 1; return; }
    if (/^WR\d+$/i.test(name)) { counts.WR += 1; return; }
    if (/^TE\d+$/i.test(name) || name === 'TE1') { counts.TE += 1; return; }
    if (/^FLEX\d+$/i.test(name)) { counts.FLEX += 1; return; }
    if (/^SUPER$/i.test(name) || /^SUPER\d+$/i.test(name)) { counts.SUPER += 1; }
  });
  return counts;
}

// Decide eligible positions for SUPER and FLEX slots
function isEligibleForSuper(pos) {
  return pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE';
}
function isEligibleForFlex(pos) {
  return pos === 'RB' || pos === 'WR' || pos === 'TE';
}

// Extract positions using PlayerLookup
function attachPositions(players, playersData, playerIdMap) {
  return players.map((p) => {
    const info = getPlayerInfo(p.id, playersData, playerIdMap);
    const pos = info && info.position ? info.position : null;
    return { ...p, position: pos };
  });
}

// Core export: compute optimal starters/bench
export function StartSitSort(teamScore, playersData, playerIdMap, playerGameLabels = null) {
  if (!teamScore) { return teamScore; }
  const starters = Array.isArray(teamScore.starters) ? teamScore.starters : [];
  const bench = Array.isArray(teamScore.bench) ? teamScore.bench : [];
  // Filter out API placeholder rows that use id '0' or missing ids
  const filtered = [...starters, ...bench].filter((p) => p && p.id && String(p.id) !== '0');
  const combined = attachPositions(filtered, playersData, playerIdMap).map((p) => ({
    id: p.id,
    pts: typeof p.pts === 'number' ? p.pts : 0,
    position: p.position || null
  }));

  const counts = getPositionCountsFromConfig();

  // Group by position
  const sortByPointsDesc = buildSorter(playerGameLabels);
  const qbs = sortByPointsDesc(combined.filter(p => p.position === 'QB'));
  const rbs = sortByPointsDesc(combined.filter(p => p.position === 'RB'));
  const wrs = sortByPointsDesc(combined.filter(p => p.position === 'WR'));
  const tes = sortByPointsDesc(combined.filter(p => p.position === 'TE'));

  // Track selected ids to avoid reusing in later slots
  const usedIds = new Set();
  const selectedQB = [];
  const selectedRB = [];
  const selectedWR = [];
  const selectedTE = [];
  const selectedSUPER = [];
  const selectedFLEX = [];

  // Helper: take top N from list not yet used
  function takeTop(list, n) {
    const taken = [];
    for (let i = 0; i < list.length && taken.length < n; i++) {
      const p = list[i];
      if (!p || !p.id) { continue; }
      if (usedIds.has(p.id)) { continue; }
      taken.push(p);
      usedIds.add(p.id);
    }
    return taken;
  }

  // Fill fixed slots first
  if (counts.QB > 0) {
    const want = counts.QB;
    const picks = takeTop(qbs, want);
    for (const p of picks) { selectedQB.push(p); }
  }
  if (counts.RB > 0) {
    const want = counts.RB;
    const picks = takeTop(rbs, want);
    for (const p of picks) { selectedRB.push(p); }
  }
  if (counts.WR > 0) {
    const want = counts.WR;
    const picks = takeTop(wrs, want);
    for (const p of picks) { selectedWR.push(p); }
  }
  if (counts.TE > 0) {
    const want = counts.TE;
    const picks = takeTop(tes, want);
    for (const p of picks) { selectedTE.push(p); }
  }

  // Remaining pool (exclude used)
  const remaining = sortByPointsDesc(combined.filter(p => !usedIds.has(p.id)));

  // FLEX then SUPER fill order per requirement
  // FLEX slots (RB/WR/TE eligible) filled before SUPER
  if (counts.FLEX > 0) {
    let flexLeft = counts.FLEX;
    for (let i = 0; i < remaining.length && flexLeft > 0; i++) {
      const p = remaining[i];
      if (!p || !p.id || usedIds.has(p.id)) { continue; }
      if (!isEligibleForFlex(p.position)) { continue; }
      selectedFLEX.push(p);
      usedIds.add(p.id);
      flexLeft -= 1;
    }
  }

  // Recompute remaining after FLEX
  let remainingAfterFlex = sortByPointsDesc(combined.filter(p => !usedIds.has(p.id)));

  // SUPER slots (QB/RB/WR/TE eligible) filled after FLEX
  if (counts.SUPER > 0) {
    let superLeft = counts.SUPER;
    for (let i = 0; i < remainingAfterFlex.length && superLeft > 0; i++) {
      const p = remainingAfterFlex[i];
      if (!p || !p.id || usedIds.has(p.id)) { continue; }
      if (!isEligibleForSuper(p.position)) { continue; }
      selectedSUPER.push(p);
      usedIds.add(p.id);
      superLeft -= 1;
    }
  }

  // Finalize Ordered Starters by mapping back to STARTER_POSITION_NAMES slot ordering
  // For rendering, we preserve the order of STARTER_POSITION_NAMES by selecting from selectedStarters accordingly
  const slotNames = STARTER_POSITION_NAMES || [];
  const startersBySlot = [];

  // Create buckets of selected players by position for deterministic pickup
  const buckets = {
    QB: sortByPointsDesc(selectedQB),
    RB: sortByPointsDesc(selectedRB),
    WR: sortByPointsDesc(selectedWR),
    TE: sortByPointsDesc(selectedTE),
    SUPER: sortByPointsDesc(selectedSUPER),
    FLEX: sortByPointsDesc(selectedFLEX)
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

  for (const name of slotNames) {
    if (/^QB\d+$/i.test(name) || name === 'QB1') {
      startersBySlot.push(popNext('QB'));
    } else if (/^RB\d+$/i.test(name)) {
      startersBySlot.push(popNext('RB'));
    } else if (/^WR\d+$/i.test(name)) {
      startersBySlot.push(popNext('WR'));
    } else if (/^TE\d+$/i.test(name) || name === 'TE1') {
      startersBySlot.push(popNext('TE'));
    } else if (/^SUPER$/i.test(name) || /^SUPER\d+$/i.test(name)) {
      startersBySlot.push(popNext('SUPER'));
    } else if (/^FLEX\d+$/i.test(name)) {
      startersBySlot.push(popNext('FLEX'));
    } else {
      startersBySlot.push(null);
    }
  }

  // Clean nulls, fill with blank placeholders if necessary for rendering
  const normalizedStarters = startersBySlot.map((p) => p ? { id: p.id, pts: p.pts } : { id: '0', pts: 0 });

  // Bench is everyone else
  const selectedIds = new Set([
    ...selectedQB.map(p => p.id),
    ...selectedRB.map(p => p.id),
    ...selectedWR.map(p => p.id),
    ...selectedTE.map(p => p.id),
    ...selectedSUPER.map(p => p.id),
    ...selectedFLEX.map(p => p.id)
  ]);
  const benchOut = sortByPointsDesc(
    combined.filter(p => !selectedIds.has(p.id) && p.id && String(p.id) !== '0')
  ).map(p => ({ id: p.id, pts: p.pts }));

  // Totals (rounded to nearest 0.01)
  const rawStarterTotal = normalizedStarters.reduce((sum, p) => sum + (typeof p.pts === 'number' ? p.pts : 0), 0);
  const rawBenchTotal = benchOut.reduce((sum, p) => sum + (typeof p.pts === 'number' ? p.pts : 0), 0);
  const starterTotal = Number(rawStarterTotal.toFixed(2));
  const benchTotal = Number(rawBenchTotal.toFixed(2));

  return {
    ...teamScore,
    starters: normalizedStarters,
    bench: benchOut,
    starterTotal,
    benchTotal
  };
}

export default StartSitSort;


