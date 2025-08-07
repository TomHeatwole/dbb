// ScoresParser.js
// Helper functions for parsing and analyzing weeksParsedData

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

export function getScoresPositionalBreakdown(weeksParsedData, start_week, end_week, roster_id) {
  // Returns an array of objects, one per week, each with position scores for the given roster_id
  // Positions are determined by the index in the starters array for each week
  if (!weeksParsedData || !Array.isArray(weeksParsedData)) return [];
  const result = [];
  for (let w = start_week; w <= end_week; ++w) {
    const weekIdx = w - 1;
    const week = weeksParsedData[weekIdx];
    if (!week) {
      result.push(null);
      continue;
    }
    // Find the entry for the given roster_id
    const entry = week.find(e => e && e.roster_id === roster_id);
    if (!entry || !entry.starters || !entry.starters_points) {
      result.push(null);
      continue;
    }
    // Map each position index to the player id and points
    const positions = entry.starters.map((pid, idx) => ({
      pos: idx,
      player_id: pid,
      points: entry.starters_points[idx] != null ? entry.starters_points[idx] : 0
    }));
    result.push(positions);
  }
  return result;
} 