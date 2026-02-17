// DraftOrderHelper.js
// Shared utility for calculating draft order based on final season standings

import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';

/**
 * Calculate the draft order for a given season.
 * Returns a map of placement (1-10) to roster ID.
 * Lower placement = better finish = later draft pick (e.g., place 1 = champion = pick 1.10)
 * 
 * @param {string} season - The season year
 * @param {Array} weeksData - Array of weekly scores data
 * @param {Object} teamData - Team data with rosters array
 * @param {Object} playersData - Players data (needed for 2025+ seasons)
 * @param {Object} playerIdMap - Player ID map (needed for 2025+ seasons)
 * @returns {Object} Map of { 1: rosterId, 2: rosterId, ..., 10: rosterId }
 */
export function calculateDraftOrder(season, weeksData, teamData, playersData = null, playerIdMap = null) {
  const seasonNum = Number(season);
  if (!Number.isFinite(seasonNum)) {
    throw new Error('Invalid season');
  }
  if (!Array.isArray(weeksData) || !teamData || !Array.isArray(teamData.rosters)) {
    throw new Error('Invalid data for draft order calculation');
  }

  let placeToRosterId = {};
  const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);

  // For 2024, use simple total season points
  if (String(season) === '2024') {
    const standingsAll = getStandings(weeksData) || [];
    const ordered = standingsAll
      .slice()
      .sort((a, b) => {
        if ((a.place || 999) !== (b.place || 999)) {
          return (a.place || 999) - (b.place || 999);
        }
        if ((b.points_scored || 0) !== (a.points_scored || 0)) {
          return (b.points_scored || 0) - (a.points_scored || 0);
        }
        return Number(a.roster_id) - Number(b.roster_id);
      })
      .map((r) => Number(r.roster_id));
    for (let i = 0; i < ordered.length; i += 1) {
      placeToRosterId[i + 1] = ordered[i];
    }
    return placeToRosterId;
  }

  // For 2025+, use playoff bracket logic
  // Seeds are top 4 after regular season (Weeks 1-14)
  const weeks14 = (weeksData || []).slice(0, 14).filter(Boolean);
  const standings14 = getStandings(weeks14) || [];
  const top4Seeds = standings14
    .slice()
    .sort((a, b) => {
      if ((a.place || 999) !== (b.place || 999)) {
        return (a.place || 999) - (b.place || 999);
      }
      if ((b.points_scored || 0) !== (a.points_scored || 0)) {
        return (b.points_scored || 0) - (a.points_scored || 0);
      }
      return Number(a.roster_id) - Number(b.roster_id);
    })
    .slice(0, 4)
    .map((r, idx) => ({ rosterId: Number(r.roster_id), seed: idx + 1 }));

  if (top4Seeds.length !== 4) {
    throw new Error('Unable to determine top 4 seeds');
  }

  const seed1 = top4Seeds.find((s) => s.seed === 1);
  const seed2 = top4Seeds.find((s) => s.seed === 2);
  const seed3 = top4Seeds.find((s) => s.seed === 3);
  const seed4 = top4Seeds.find((s) => s.seed === 4);
  if (!seed1 || !seed2 || !seed3 || !seed4) {
    throw new Error('Invalid seed data');
  }

  function computeWeekTotal(rid, weekNum) {
    const weekArr = Array.isArray(weeksData) ? weeksData[weekNum - 1] : null;
    const entry = Array.isArray(weekArr)
      ? weekArr.find((e) => e && Number(e.roster_id) === Number(rid))
      : null;
    let total =
      entry && typeof entry.points === 'number' && Number.isFinite(entry.points)
        ? Math.round(entry.points * 10) / 10
        : 0;
    try {
      const breakdown = getWeekScoreBreakdown(weeksData, weekNum, teamData.rosters) || {};
      const teamScore = breakdown && breakdown[rid];
      if (teamScore && playersData && playerIdMap) {
        const computed = StartSitSort(teamScore, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
        if (computed && typeof computed.starterTotal === 'number') {
          total = Math.round(computed.starterTotal * 10) / 10;
        }
      }
    } catch (_) {
      // keep Sleeper API points fallback
    }
    return total;
  }

  // Semifinals cumulative Weeks 15-16
  const semiTotals = {};
  const seeds = [seed1, seed2, seed3, seed4];
  for (const s of seeds) {
    semiTotals[s.rosterId] = 0;
  }
  for (let wk = 15; wk <= 16; wk += 1) {
    for (const s of seeds) {
      semiTotals[s.rosterId] += computeWeekTotal(s.rosterId, wk);
    }
  }

  const topWinner =
    semiTotals[seed1.rosterId] > semiTotals[seed4.rosterId] ||
    (semiTotals[seed1.rosterId] === semiTotals[seed4.rosterId] && (seed1.seed || 999) < (seed4.seed || 999))
      ? seed1
      : seed4;
  const topLoser = topWinner.rosterId === seed1.rosterId ? seed4 : seed1;

  const bottomWinner =
    semiTotals[seed2.rosterId] > semiTotals[seed3.rosterId] ||
    (semiTotals[seed2.rosterId] === semiTotals[seed3.rosterId] && (seed2.seed || 999) < (seed3.seed || 999))
      ? seed2
      : seed3;
  const bottomLoser = bottomWinner.rosterId === seed2.rosterId ? seed3 : seed2;

  // Finals Week 17 + Semis Buffer (matches /yoffs)
  const finalsTotals = {
    [topWinner.rosterId]: computeWeekTotal(topWinner.rosterId, 17),
    [bottomWinner.rosterId]: computeWeekTotal(bottomWinner.rosterId, 17),
  };
  const topWinnerSemi = semiTotals[topWinner.rosterId] || 0;
  const bottomWinnerSemi = semiTotals[bottomWinner.rosterId] || 0;
  const highSemi = Math.max(topWinnerSemi, bottomWinnerSemi);
  const lowSemi = Math.min(topWinnerSemi, bottomWinnerSemi);
  const buffer = highSemi > lowSemi ? (highSemi - lowSemi) / 2 : 0;
  if (buffer > 0) {
    if (topWinnerSemi > bottomWinnerSemi) {
      finalsTotals[topWinner.rosterId] = Math.round((finalsTotals[topWinner.rosterId] + buffer) * 10) / 10;
    } else if (bottomWinnerSemi > topWinnerSemi) {
      finalsTotals[bottomWinner.rosterId] = Math.round((finalsTotals[bottomWinner.rosterId] + buffer) * 10) / 10;
    }
  }

  const champion =
    finalsTotals[topWinner.rosterId] > finalsTotals[bottomWinner.rosterId] ||
    (finalsTotals[topWinner.rosterId] === finalsTotals[bottomWinner.rosterId] &&
      (topWinner.seed || 999) < (bottomWinner.seed || 999))
      ? topWinner
      : bottomWinner;
  const runnerUp = champion.rosterId === topWinner.rosterId ? bottomWinner : topWinner;

  const third =
    semiTotals[topLoser.rosterId] > semiTotals[bottomLoser.rosterId] ||
    (semiTotals[topLoser.rosterId] === semiTotals[bottomLoser.rosterId] &&
      (topLoser.seed || 999) < (bottomLoser.seed || 999))
      ? topLoser
      : bottomLoser;
  const fourth = third.rosterId === topLoser.rosterId ? bottomLoser : topLoser;

  // Places 5-10 follow regular season order excluding seeds
  const seedSet = new Set([seed1.rosterId, seed2.rosterId, seed3.rosterId, seed4.rosterId].map(String));
  const remaining = standings14
    .slice()
    .sort((a, b) => {
      if ((a.place || 999) !== (b.place || 999)) {
        return (a.place || 999) - (b.place || 999);
      }
      if ((b.points_scored || 0) !== (a.points_scored || 0)) {
        return (b.points_scored || 0) - (a.points_scored || 0);
      }
      return Number(a.roster_id) - Number(b.roster_id);
    })
    .map((r) => Number(r.roster_id))
    .filter((rid) => !seedSet.has(String(rid)));

  placeToRosterId = {
    1: champion.rosterId,
    2: runnerUp.rosterId,
    3: third.rosterId,
    4: fourth.rosterId,
  };
  let nextPlace = 5;
  for (const rid of remaining) {
    if (nextPlace > 10) {
      break;
    }
    placeToRosterId[nextPlace] = rid;
    nextPlace += 1;
  }

  return placeToRosterId;
}

/**
 * Convert a draft order map to a pick lookup map.
 * Given placeToRosterId (1-10 -> rosterId), return rosterIdToPickNum (rosterId -> pick number)
 * Pick number is inverse: 1st place = pick 10, 10th place = pick 1
 * 
 * @param {Object} placeToRosterId - Map of placement to roster ID
 * @returns {Object} Map of roster ID to pick number (1-10)
 */
export function convertPlacementToPickNumbers(placeToRosterId) {
  const rosterIdToPickNum = {};
  for (let place = 1; place <= 10; place += 1) {
    const rosterId = placeToRosterId[place];
    if (rosterId != null) {
      const pickNum = 11 - place; // Inverse: 1st place = 10th pick
      rosterIdToPickNum[String(rosterId)] = pickNum;
    }
  }
  return rosterIdToPickNum;
}
