// ScoresParser.js
// Helper functions for parsing and analyzing weeksParsedData

import { STARTER_POSITION_NAMES } from './global_constants';

export function getStandings(weeksParsedData) {
  // Accumulate points for each roster_id
  const pointsMap = {};
  if (!weeksParsedData) return [];
  for (const week of weeksParsedData) {
    if (!week) continue;
    for (const entry of week) {
      if (!entry || entry.roster_id == null) continue;
      if (!pointsMap[entry.roster_id]) pointsMap[entry.roster_id] = 0;
      pointsMap[entry.roster_id] += entry.points;
    }
  }
  // Convert to array for sorting, round to nearest tenth
  let arr = Object.entries(pointsMap).map(([roster_id, points_scored]) => ({
    roster_id: Number(roster_id),
    points_scored: Math.round(points_scored * 10) / 10
  }));
  // Sort descending by points_scored
  arr.sort((a, b) => b.points_scored - a.points_scored);
  // Assign place and numTied, skipping places for ties
  let place = 1;
  let i = 0;
  while (i < arr.length) {
    const tieGroup = arr.filter(x => x.points_scored === arr[i].points_scored);
    const numTied = tieGroup.length;
    for (let j = 0; j < numTied; ++j) {
      arr[i + j].place = place;
      arr[i + j].numTied = numTied;
    }
    i += numTied;
    place += numTied;
  }
  // Already sorted by score descending
  return arr;
}

export function getPlayerTotals(weeksParsedData) {
  // { roster_id: { roster_id, players: [ { id, pts } ] } }
  const result = {};
  if (!weeksParsedData) return result;
  for (const week of weeksParsedData) {
    if (!week) continue;
    for (const entry of week) {
      if (!entry || entry.roster_id == null || !entry.players_points) continue;
      const rid = entry.roster_id;
      if (!result[rid]) result[rid] = { roster_id: rid, players: {} };
      for (const [pid, pts] of Object.entries(entry.players_points)) {
        if (!result[rid].players[pid]) result[rid].players[pid] = 0;
        result[rid].players[pid] += pts;
      }
    }
  }
  // Convert players object to array for each roster, sorted by pts descending and rounded to one decimal
  for (const rid in result) {
    result[rid].players = Object.entries(result[rid].players)
      .map(([id, pts]) => ({ id, pts: Math.round(pts * 10) / 10 }))
      .sort((a, b) => b.pts - a.pts);
  }
  return result;
}

export function getWeekScoreBreakdown(weeksParsedData, week) {
  // week is 1-based index
  if (!weeksParsedData || !weeksParsedData[week - 1]) return {};
  const weekData = weeksParsedData[week - 1];
  const result = {};
  for (const entry of weekData) {
    if (!entry || entry.roster_id == null) continue;
    const starters = (entry.starters || []).map((pid, i) => ({
      id: pid,
      pts: entry.starters_points && entry.starters_points[i] != null ? entry.starters_points[i] : 0
    }));
    // Bench = all players not in starters
    const starterSet = new Set(entry.starters || []);
    const bench = (entry.players || [])
      .filter(pid => !starterSet.has(pid))
      .map(pid => ({
        id: pid,
        pts: entry.players_points && entry.players_points[pid] != null ? entry.players_points[pid] : 0
      }));
    const starterTotal = starters.reduce((sum, p) => sum + p.pts, 0);
    const benchTotal = bench.reduce((sum, p) => sum + p.pts, 0);
    result[entry.roster_id] = {
      starters,
      bench,
      starterTotal: Math.round(starterTotal * 10) / 10,
      benchTotal: Math.round(benchTotal * 10) / 10
    };
  }
  return result;
}

export function getWeeklyStandings(weeksParsedData, start_week, end_week) {
  // weeksParsedData: array of weeks, each week is array of entries
  // start_week, end_week: 1-based inclusive
  if (!weeksParsedData || !Array.isArray(weeksParsedData)) return [];
  const standingsByWeek = [];
  const runningTotals = {};
  for (let w = start_week; w <= end_week; ++w) {
    const weekIdx = w - 1;
    const week = weeksParsedData[weekIdx];
    if (!week) {
      standingsByWeek.push([]);
      continue;
    }
    // Map roster_id to points for this week
    const weekPoints = {};
    for (const entry of week) {
      if (!entry || entry.roster_id == null) continue;
      weekPoints[entry.roster_id] = entry.points;
      if (!runningTotals[entry.roster_id]) runningTotals[entry.roster_id] = 0;
      runningTotals[entry.roster_id] += entry.points;
    }
    // Build standings for this week
    const weekArr = Object.entries(weekPoints).map(([rosterId, points]) => ({
      rosterId: Number(rosterId),
      points: Math.round(points * 10) / 10,
      runningTotalPoints: Math.round(runningTotals[rosterId] * 10) / 10
    }));
    // Sort by points descending
    weekArr.sort((a, b) => b.points - a.points);
    standingsByWeek.push(weekArr);
  }
  return standingsByWeek;
}

export function getPositionalBreakdownData(weeksParsedData, start_week, end_week) {
  // Collect all roster_ids
  const rosterIds = new Set();
  if (!weeksParsedData || !Array.isArray(weeksParsedData)) return [];
  for (let w = start_week; w <= end_week; ++w) {
    const weekIdx = w - 1;
    const week = weeksParsedData[weekIdx];
    if (!week) continue;
    for (const entry of week) {
      if (entry && entry.roster_id != null) {
        rosterIds.add(entry.roster_id);
      }
    }
  }

  // Initialize data structures for each team
  const teamDataMap = {};
  for (const rid of rosterIds) {
    teamDataMap[rid] = {
      roster_id: Number(rid),
      positional_scores: Array(STARTER_POSITION_NAMES.length).fill(0).map(() => []), // array of arrays for each position
      positional_player_breakdown: Array(STARTER_POSITION_NAMES.length).fill(0).map(() => ({})), // array of maps for each position, playerId -> { starts, cumulative_score }
    };
  }

  // Fill in data
  for (let w = start_week; w <= end_week; ++w) {
    const weekIdx = w - 1;
    const week = weeksParsedData[weekIdx];
    if (!week) continue;
    for (const entry of week) {
      if (!entry || entry.roster_id == null || !entry.starters || !entry.starters_points) continue;
      const rid = entry.roster_id;
      for (let pos = 0; pos < 11; ++pos) {
        const pid = entry.starters[pos];
        const pts = entry.starters_points[pos];
        // If no player in this position, treat as 0
        const score = pts != null ? pts : 0;
        teamDataMap[rid].positional_scores[pos].push(score);
        if (pid != null) {
          if (!teamDataMap[rid].positional_player_breakdown[pos][pid]) {
            teamDataMap[rid].positional_player_breakdown[pos][pid] = { starts: 0, cumulative_score: 0 };
          }
          teamDataMap[rid].positional_player_breakdown[pos][pid].starts += 1;
          teamDataMap[rid].positional_player_breakdown[pos][pid].cumulative_score += score;
        }
      }
    }
  }

  // Build result
  const result = [];
  for (const rid of rosterIds) {
    const team = teamDataMap[rid];
    const positional_average_scores = team.positional_scores.map(scores => {
      if (scores.length === 0) return 0;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return Math.round(avg * 10) / 10;
    });
    result.push({
      roster_id: team.roster_id,
      positional_average_scores,
      positional_player_breakdown: team.positional_player_breakdown
    });
  }
  return result;
} 