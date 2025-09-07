// PlayerLookup.js
// Utility to look up player info by ID from a provided player data object

import { PLAYER_ESPN_MAP_OVERRIDES } from './global_constants';
import { updatePlayers, readCurrentWeekPlayersSnapshot } from './database';
import { fetchScoresData } from './ScoresLookup';
import { CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';

const cachedPlayersDataByKey = {};
let cachedPlayerIdMap = null;

function getCacheKey(rostersOrSeason) {
  if (!Array.isArray(rostersOrSeason) && rostersOrSeason != null) {
    return String(rostersOrSeason);
  }
  return 'current';
}

export async function fetchPlayersData(rostersOrSeason = null) {
  const cacheKey = getCacheKey(rostersOrSeason);
  if (cachedPlayersDataByKey[cacheKey]) { return cachedPlayersDataByKey[cacheKey]; }
  // Allow passing a season string instead of rosters to force legacy path
  let rosters = Array.isArray(rostersOrSeason) ? rostersOrSeason : null;
  const maybeSeason = !Array.isArray(rostersOrSeason) && rostersOrSeason != null ? String(rostersOrSeason) : null;
  const effectiveSeason = maybeSeason || CURRENT_YEAR;
  if (String(effectiveSeason) === '2024') {
    const res = await fetch('/data/players.txt');
    if (!res.ok) throw new Error('Failed to fetch player data');
    const data = await res.json();
    cachedPlayersDataByKey[cacheKey] = data;
    return cachedPlayersDataByKey[cacheKey];
  }
  // Try to read current week's snapshot first
  const current = await readCurrentWeekPlayersSnapshot();
  const hasSnapshot = current && current.snapshot && current.snapshot.data && Object.keys(current.snapshot.data).length > 0;
  const isFresh = hasSnapshot && Number.isFinite(current.ageMs) && current.ageMs <= 60 * 60 * 1000;
  if (hasSnapshot && isFresh) {
    cachedPlayersDataByKey[cacheKey] = current.snapshot.data;
    return cachedPlayersDataByKey[cacheKey];
  }
  // Snapshot missing or stale: fetch if we can compute cared IDs
  if (!rosters) {
    // Try to derive minimal roster list from ScoresLookup current week
    try {
      const season = CURRENT_YEAR;
      const weeksData = await fetchScoresData(season);
      const currentWeek = getCurrentNFLWeek();
      const weekArr = Array.isArray(weeksData) ? weeksData[currentWeek - 1] : null;
      if (Array.isArray(weekArr)) { rosters = weekArr.map((e) => ({ players: (e && Array.isArray(e.players)) ? e.players : [], starters: [], bench: [] })); }
    } catch (_) {
      // ignore and fall through
    }
  }
  if (rosters && Array.isArray(rosters)) {
    // eslint-disable-next-line no-console
    console.log('[players] snapshot missing/stale; computing cared IDs from rosters', { rostersCount: rosters.length });
    const caredSet = new Set();
    for (const r of rosters) {
      if (r && Array.isArray(r.players)) {
        for (const pid of r.players) { if (pid && pid !== '0') { caredSet.add(String(pid)); } }
      }
      if (r && Array.isArray(r.starters)) {
        for (const pid of r.starters) { if (pid && pid !== '0') { caredSet.add(String(pid)); } }
      }
      if (r && Array.isArray(r.bench)) {
        for (const pid of r.bench) { if (pid && pid !== '0') { caredSet.add(String(pid)); } }
      }
    }
    const caredPlayerIds = Array.from(caredSet);
    const res = await updatePlayers(caredPlayerIds);
    const data = (res && res.snapshot && res.snapshot.data) ? res.snapshot.data : {};
    cachedPlayersDataByKey[cacheKey] = data;
    return cachedPlayersDataByKey[cacheKey];
  }
  // No rosters yet: if no snapshot or snapshot empty, do not blind fetch; return empty
  cachedPlayersDataByKey[cacheKey] = hasSnapshot ? current.snapshot.data : {};
  return cachedPlayersDataByKey[cacheKey];
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
  // Use override if still not found
  if (!espn_id && PLAYER_ESPN_MAP_OVERRIDES && PLAYER_ESPN_MAP_OVERRIDES[playerId]) {
    espn_id = PLAYER_ESPN_MAP_OVERRIDES[playerId];
  }
  return {
    name: player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim(),
    position: player.position || (player.fantasy_positions && player.fantasy_positions[0]) || '',
    espn_photo_url: espn_id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espn_id}.png` : null,
    ...player
  };
} 