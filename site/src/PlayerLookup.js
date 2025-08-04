// PlayerLookup.js
// Utility to look up player info by ID from a provided player data object

let cachedPlayersData = null;
let cachedPlayerIdMap = null;

export async function fetchPlayersData() {
  if (cachedPlayersData) return cachedPlayersData;
  const res = await fetch('/data/players.txt');
  if (!res.ok) throw new Error('Failed to fetch player data');
  const data = await res.json();
  cachedPlayersData = data;
  return data;
}

export async function fetchPlayerIdMap() {
  if (cachedPlayerIdMap) return cachedPlayerIdMap;
  const res = await fetch('/data/player_ids.txt');
  if (!res.ok) throw new Error('Failed to fetch player_ids.txt');
  const text = await res.text();
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  const sleeperIdx = header.indexOf('sleeper_id');
  const espnIdx = header.indexOf('espn_id');
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length > Math.max(sleeperIdx, espnIdx)) {
      map[cols[sleeperIdx]] = cols[espnIdx] || null;
    }
  }
  cachedPlayerIdMap = map;
  return map;
}

export function getPlayerInfo(playerId, playersData, playerIdMap) {
  if (!playersData) return null;
  const player = playersData[playerId];
  if (!player) return null;
  let espn_id = player.espn_id;
  if (!espn_id && playerIdMap) {
    espn_id = playerIdMap[playerId];
  }
  return {
    name: player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim(),
    position: player.position || (player.fantasy_positions && player.fantasy_positions[0]) || '',
    espn_photo_url: espn_id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espn_id}.png` : null,
    ...player
  };
} 