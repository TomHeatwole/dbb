// PlayerLookup.js
// Utility to look up player info by ID from a provided player data object

let cachedPlayersData = null;

export async function fetchPlayersData() {
  if (cachedPlayersData) return cachedPlayersData;
  const res = await fetch('/data/players.txt');
  if (!res.ok) throw new Error('Failed to fetch player data');
  const data = await res.json();
  cachedPlayersData = data;
  return data;
}

export function getPlayerInfo(playerId, playersData) {
  if (!playersData) return null;
  const player = playersData[playerId];
  if (!player) return null;
  return {
    name: player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim(),
    position: player.position || (player.fantasy_positions && player.fantasy_positions[0]) || '',
    ...player
  };
} 