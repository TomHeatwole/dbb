/**
 * Build the score snapshot the settlement resolver reads.
 *
 * Truth is Sleeper matchup points (weeksParsedData from fetchScoresData),
 * not the Monte Carlo. completedWeeks must be the official completed-week
 * count — in-progress live scores must not grade a weekly market.
 */

import {
  buildFinalStandings,
  normalizePlayoffFormat,
  playoffFormatForSeason,
} from '../scenarios/playoffStandings';

export { playoffFormatForSeason };

const REG_SEASON_END = 14;
const SEASON_END = 17;

function tenth(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function collectWeekPoints(weeksParsedData, completedWeeks) {
  const weekPoints = {};
  const rosterIds = new Set();
  const limit = Math.max(0, Math.min(SEASON_END, Number(completedWeeks) || 0));
  for (let week = 1; week <= limit; week += 1) {
    const rows = weeksParsedData?.[week - 1];
    if (!Array.isArray(rows)) continue;
    const map = {};
    for (const entry of rows) {
      if (!entry || entry.roster_id == null) continue;
      const id = Number(entry.roster_id);
      if (!Number.isInteger(id)) continue;
      map[id] = tenth(entry.points);
      rosterIds.add(id);
    }
    weekPoints[week] = map;
  }
  return { weekPoints, rosterIds: [...rosterIds].sort((a, b) => a - b) };
}

function sumRange(weekPoints, rosterId, start, end) {
  let sum = 0;
  for (let w = start; w <= end; w += 1) {
    const pts = weekPoints[w]?.[rosterId];
    if (pts == null) continue;
    sum += pts;
  }
  return tenth(sum);
}

function buildFinals(weekPoints, rosterIds, completedWeeks, format) {
  if (completedWeeks < SEASON_END) return null;
  const regSeasonTotals = {};
  const playoffTotals = {};
  const playoffWeekTotals = {};
  for (const id of rosterIds) {
    regSeasonTotals[id] = sumRange(weekPoints, id, 1, REG_SEASON_END);
    playoffWeekTotals[id] = [
      weekPoints[15]?.[id] ?? 0,
      weekPoints[16]?.[id] ?? 0,
      weekPoints[17]?.[id] ?? 0,
    ];
    playoffTotals[id] = tenth(
      playoffWeekTotals[id][0] + playoffWeekTotals[id][1] + playoffWeekTotals[id][2],
    );
  }
  return buildFinalStandings(regSeasonTotals, playoffTotals, {
    format: normalizePlayoffFormat(format),
    playoffWeekTotals,
  });
}

/**
 * @param {Array} weeksParsedData  0-indexed weeks from fetchScoresData
 * @param {{ completedWeeks: number, season?: number, playoffFormat?: string }} options
 */
export function buildSettlementSnapshot(weeksParsedData, options = {}) {
  const completedWeeks = Math.max(0, Math.min(SEASON_END, Number(options.completedWeeks) || 0));
  const season = options.season;
  const playoffFormat = options.playoffFormat
    ? normalizePlayoffFormat(options.playoffFormat)
    : playoffFormatForSeason(season);
  const { weekPoints, rosterIds } = collectWeekPoints(weeksParsedData, completedWeeks);
  return {
    completedWeeks,
    season: season ?? null,
    playoffFormat,
    weekPoints,
    rosterIds,
    finalStandings: buildFinals(weekPoints, rosterIds, completedWeeks, playoffFormat),
  };
}
