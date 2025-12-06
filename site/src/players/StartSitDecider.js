// StartSitDecider.js
// Builds an optimal lineup from a team's weekly players list, ignoring provided starter/bench flags

import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { getPlayerInfo } from '../lookups/PlayerLookup';

// Helper: determine detailed injury category for a player.
// Categories:
// - 'healthy'       -> no notable designation
// - 'questionable'  -> Q
// - 'doubtful'      -> D
// - 'injured'       -> Out, IR, Suspended, PUP, NA, etc.
function getInjuryCategory(playerId, playersData, playerIdMap, injuriesMap) {
  function extractStatus(raw) {
    if (!raw) {
      return null;
    }
    const s = String(raw).toLowerCase();
    if (s === 'q' || s.includes('questionable')) {
      return 'questionable';
    }
    if (s === 'd' || s.includes('doubtful')) {
      return 'doubtful';
    }
    if (/out|pup|suspended|ir|injured reserve|na/.test(s)) {
      return 'injured';
    }
    return null;
  }

  // First check the injuriesMap (used for past weeks)
  if (injuriesMap && typeof injuriesMap === 'object') {
    const raw = injuriesMap[String(playerId)];
    const cat = extractStatus(raw);
    if (cat) {
      return cat;
    }
  }

  // Also check playersData for current week injury status
  if (playersData && playerIdMap) {
    const info = getPlayerInfo(playerId, playersData, playerIdMap);
    if (info) {
      const raw =
        info.injury_status ||
        info.injury_notes ||
        (info.status &&
          /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(
            info.status
          )
          ? info.status
          : null);
      const cat = extractStatus(raw);
      if (cat) {
        return cat;
      }
    }
  }

  return 'healthy';
}

// Helper: sort players by priority rules
// Precedence (highest priority first):
// 1. Score (highest first)
// 2. Injury status (healthy/Q > injured) – only when scores are equal
// 3. BYE status (non-BYE > BYE) – only when scores and injury are equal
// 4. Game status (unplayed > in-progress > completed) – only when scores, injury and BYE are equal
// 5. Season totals (highest first) – only when scores, injury, BYE and game status are equal
// 6. Player ID (stable sort)
function buildSorter(playerGameLabels, playersData, playerIdMap, injuriesMap, playerSeasonTotalsMap) {
  return function sortByGameAware(players) {
    return players.slice().sort((a, b) => {
      // RULE 1: Score - highest score wins
      if (b.pts !== a.pts) {
        return b.pts - a.pts;
      }

      // From here down, scores are exactly equal.

      // RULE 2: Injury tier (within equal scores)
      // Tier order (best to worst):
      //   healthy/questionable  <  doubtful (D)  <  injured (Out/IR/Susp/etc.)
      const aInjuryCat = getInjuryCategory(a.id, playersData, playerIdMap, injuriesMap);
      const bInjuryCat = getInjuryCategory(b.id, playersData, playerIdMap, injuriesMap);
      function injuryRank(cat) {
        if (cat === 'doubtful') { return 1; }
        if (cat === 'injured') { return 2; }
        // 'healthy' and 'questionable' treated the same
        return 0;
      }
      const aInjuryRank = injuryRank(aInjuryCat);
      const bInjuryRank = injuryRank(bInjuryCat);
      if (aInjuryRank !== bInjuryRank) {
        return aInjuryRank - bInjuryRank; // lower rank (healthier) sorts first
      }

      // Determine game status for each player
      const aLab = playerGameLabels && playerGameLabels[a.id];
      const bLab = playerGameLabels && playerGameLabels[b.id];

      // RULE 3: BYE status - non-BYE before BYE when otherwise tied
      const aBye = !!(aLab && aLab.text === 'BYE');
      const bBye = !!(bLab && bLab.text === 'BYE');
      if (aBye !== bBye) {
        return aBye ? 1 : -1; // non-BYE (false) sorts before BYE (true)
      }
      
      // Game status values: 0 = unplayed, 1 = in-progress, 2 = completed
      const getGameStatus = (label) => {
        if (!label) {
          return 0; // no game info = unplayed
        }
        if (label.completed) {
          return 2; // completed
        }
        if (label.live) {
          return 1; // in-progress
        }
        return 0; // unplayed
      };
      
      const aGameStatus = getGameStatus(aLab);
      const bGameStatus = getGameStatus(bLab);
      
      // RULE 4: Game status - unplayed > in-progress > completed
      if (aGameStatus !== bGameStatus) {
        return aGameStatus - bGameStatus; // lower value (unplayed) sorts first
      }

      // RULE 5: Season totals - higher season total wins
      if (playerSeasonTotalsMap) {
        const aSeasonTotal = playerSeasonTotalsMap[String(a.id)] || 0;
        const bSeasonTotal = playerSeasonTotalsMap[String(b.id)] || 0;
        if (aSeasonTotal !== bSeasonTotal) {
          return bSeasonTotal - aSeasonTotal; // higher total sorts first
        }
      }

      // RULE 6: Stable sort by player ID
      const aId = String(a.id || '');
      const bId = String(b.id || '');
      if (aId < bId) {
        return -1;
      }
      if (aId > bId) {
        return 1;
      }
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
export function StartSitSort(teamScore, playersData, playerIdMap, playerGameLabels = null, injuriesMap = null, playerSeasonTotalsMap = null) {
  if (!teamScore) {
    return teamScore;
  }
  
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
  const sortByPointsDesc = buildSorter(playerGameLabels, playersData, playerIdMap, injuriesMap, playerSeasonTotalsMap);
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


