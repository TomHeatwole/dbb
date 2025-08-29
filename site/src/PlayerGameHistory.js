// PlayerGameHistory.js
// Fetch per-player game history from /data/player_games/<espn_id>.txt only

const historyCache = {};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(String(res.status));
  }
  return res.json();
}

export async function fetchPlayerHistoryByEspnId(espnId) {
  if (!espnId) { return null; }
  if (historyCache[espnId]) { return historyCache[espnId]; }
  const data = await fetchJson(`/data/player_games/${espnId}.txt`);
  historyCache[espnId] = data;
  return data;
}

export async function fetchHistoriesByEspnIds(espnIds) {
  const unique = Array.from(new Set((Array.isArray(espnIds) ? espnIds : []).filter(Boolean)));
  const results = await Promise.all(unique.map(id => fetchPlayerHistoryByEspnId(id).then(h => [id, h]).catch(() => [id, null])));
  const map = {};
  for (const [id, h] of results) { map[id] = h || null; }
  return map;
}

export function getTeamAtDate(history, isoDate) {
  if (!history || !isoDate) { return null; }
  // Flatten {year: [games]} into one list and pick the last game with date <= isoDate
  const allGames = [];
  for (const [, games] of Object.entries(history)) {
    if (!Array.isArray(games)) { continue; }
    for (const g of games) {
      if (g && g.date) { allGames.push(g); }
    }
  }
  if (allGames.length === 0) { return null; }
  const target = new Date(isoDate);
  // Sort by date ascending
  allGames.sort((a, b) => new Date(a.date) - new Date(b.date));
  let lastTeam = null;
  for (const g of allGames) {
    const d = new Date(g.date);
    if (d <= target) {
      lastTeam = g.team || lastTeam;
    } else {
      break;
    }
  }
  return lastTeam;
} 