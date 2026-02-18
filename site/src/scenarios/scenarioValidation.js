/**
 * Scenario roster validity checks.
 *
 * Rules:
 *   1. No player may appear on more than one team's roster.
 *   2. No team roster may exceed MAX_ROSTER_SIZE players.
 *
 * These checks run against scenarioRosters (the post-change state).
 * Violations are surfaced as a notice; evaluation still proceeds.
 */

const MAX_ROSTER_SIZE = 27;

/**
 * Validate modified scenario rosters for duplicate players and oversized rosters.
 *
 * @param {Object} scenarioRosters  – { [rosterId]: string[] }  Sleeper player IDs
 * @param {Array}  teamsForGrid     – [{ rosterId: number, teamName: string, ... }]
 * @param {Object|null} playersData – Sleeper players lookup keyed by player ID
 * @returns {{
 *   isValid: boolean,
 *   duplicatePlayers: Array<{ playerId: string, playerName: string, rosterIds: number[], teamNames: string[] }>,
 *   oversizedRosters: Array<{ rosterId: number, teamName: string, playerCount: number, limit: number }>,
 * }}
 */
export function validateScenarioRosters(scenarioRosters, teamsForGrid, playersData) {
  // Quick lookup: rosterId string → team name
  const teamNameById = {};
  for (const t of (teamsForGrid || [])) {
    teamNameById[String(t.rosterId)] = t.teamName;
  }

  // Build inverted index: playerId → [rosterId strings that have this player]
  const playerRosterMap = {};
  for (const rid in scenarioRosters) {
    for (const pid of (scenarioRosters[rid] || [])) {
      if (!playerRosterMap[pid]) playerRosterMap[pid] = [];
      playerRosterMap[pid].push(rid);
    }
  }

  // Duplicate players — appear on 2+ rosters
  const duplicatePlayers = [];
  for (const pid in playerRosterMap) {
    const rids = playerRosterMap[pid];
    if (rids.length > 1) {
      const player = playersData ? playersData[pid] : null;
      const playerName = player
        ? (player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || pid)
        : pid;
      duplicatePlayers.push({
        playerId: pid,
        playerName,
        rosterIds: rids.map(Number),
        teamNames: rids.map((r) => teamNameById[r] || `Team ${r}`),
      });
    }
  }

  // Oversized rosters
  const oversizedRosters = [];
  for (const rid in scenarioRosters) {
    const count = (scenarioRosters[rid] || []).length;
    if (count > MAX_ROSTER_SIZE) {
      oversizedRosters.push({
        rosterId: Number(rid),
        teamName: teamNameById[rid] || `Team ${rid}`,
        playerCount: count,
        limit: MAX_ROSTER_SIZE,
      });
    }
  }

  return {
    isValid: duplicatePlayers.length === 0 && oversizedRosters.length === 0,
    duplicatePlayers,
    oversizedRosters,
  };
}
