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