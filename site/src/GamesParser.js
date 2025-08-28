import { getPlayerInfo } from './PlayerLookup';

function normalizeTeamAbbr(raw) {
  if (!raw) { return null; }
  return String(raw).trim().toUpperCase();
}

function extractEvents(scoreboardJson) {
  if (!scoreboardJson || typeof scoreboardJson !== 'object') { return []; }
  if (Array.isArray(scoreboardJson.events)) { return scoreboardJson.events; }
  if (Array.isArray(scoreboardJson.leagues) && scoreboardJson.leagues.length && Array.isArray(scoreboardJson.leagues[0].events)) {
    return scoreboardJson.leagues[0].events;
  }
  return [];
}

function getEventTeamAbbreviations(event) {
  const result = [];
  if (!event) { return result; }
  const comps = Array.isArray(event.competitions) ? event.competitions : [];
  const comp = comps.length ? comps[0] : null;
  const competitors = comp && Array.isArray(comp.competitors) ? comp.competitors : [];
  for (const c of competitors) {
    const abbr = normalizeTeamAbbr(c && c.team && (c.team.abbreviation || c.team.shortDisplayName || c.team.displayName));
    if (abbr) { result.push(abbr); }
  }
  // Fallback: parse from shortName like "SF @ LAR"
  if (result.length === 0 && typeof event.shortName === 'string') {
    const parts = event.shortName.split(/\s+@\s+|\s+vs\s+/i);
    for (const p of parts) {
      const token = (p || '').replace(/[^A-Za-z]/g, '').toUpperCase();
      if (token) { result.push(token); }
    }
  }
  return result;
}

export function buildTeamToEventMap(scoreboardJson) {
  const map = {};
  const events = extractEvents(scoreboardJson);
  for (const ev of events) {
    const abbrs = getEventTeamAbbreviations(ev);
    for (const abbr of abbrs) {
      if (abbr && !map[abbr]) { map[abbr] = ev; }
    }
  }
  return map;
}

/**
 * Map player IDs to their game event for the week.
 * @param {Array<string>} playerIds - Sleeper player IDs (or consistent IDs used across the app)
 * @param {Object} playersData - Full players data (from PlayerLookup.fetchPlayersData)
 * @param {Object} playerIdMap - Sleeper->ESPN ID map (from PlayerLookup.fetchPlayerIdMap)
 * @param {Object} scoreboardJson - ESPN scoreboard JSON for the week
 * @returns {Object} playerId -> event (or null if no match)
 */
export function mapPlayersToGames(playerIds, playersData, playerIdMap, scoreboardJson) {
  const teamToEvent = buildTeamToEventMap(scoreboardJson);
  const result = {};
  const ids = Array.isArray(playerIds) ? playerIds : [];
  for (const pid of ids) {
    const info = getPlayerInfo(pid, playersData, playerIdMap);
    const team = normalizeTeamAbbr(info && (info.team || info.team_abbr));
    result[pid] = (team && teamToEvent[team]) ? teamToEvent[team] : null;
  }
  return result;
} 