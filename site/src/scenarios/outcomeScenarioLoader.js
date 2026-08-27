import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings } from '../scores/ScoresParser';

/**
 * Load league rosters + team grid metadata for a given season year.
 */
export async function loadOutcomeScenarioRosterData(season) {
  const [teamData, idMap, weeksData, players] = await Promise.all([
    fetchTeamData(season),
    fetchPlayerIdMap(),
    fetchScoresData(season).catch(() => null),
    fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
  ]);

  if (!teamData || !Array.isArray(teamData.rosters)) {
    throw new Error('No team data');
  }

  const standings = getStandings(weeksData) || [];
  const placeByRosterId = {};
  const pointsByRosterId = {};
  standings.forEach((row) => {
    if (row?.roster_id != null) {
      placeByRosterId[String(row.roster_id)] = row.place != null ? row.place : 999;
      pointsByRosterId[String(row.roster_id)] = row.points_scored ?? 0;
    }
  });

  const teamsUnsorted = (teamData.rosters || []).map((roster) => {
    const rid = roster?.roster_id != null ? Number(roster.roster_id) : null;
    if (rid == null) return null;
    const user = (teamData.users || []).find(
      (u) => String(u.user_id) === String(roster.owner_id),
    );
    let teamName = `Team ${rid}`;
    let ownerName = '';
    if (user?.metadata?.team_name) teamName = user.metadata.team_name;
    else if (user?.display_name) teamName = `Team ${user.display_name}`;
    if (user?.display_name) ownerName = user.display_name;
    const avatarUrl =
      (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
    const place = placeByRosterId[String(rid)];
    const totalPoints = pointsByRosterId[String(rid)];
    return {
      rosterId: rid,
      teamName,
      ownerName,
      avatarUrl,
      place: place && place !== 999 ? place : null,
      totalPoints: totalPoints ?? null,
    };
  }).filter(Boolean);

  const teams = teamsUnsorted.slice().sort((a, b) => {
    const pa = placeByRosterId[String(a.rosterId)] ?? 999;
    const pb = placeByRosterId[String(b.rosterId)] ?? 999;
    return pa !== pb ? pa - pb : Number(a.rosterId) - Number(b.rosterId);
  });

  const originalRosters = {};
  for (const roster of teamData.rosters) {
    const rid = roster?.roster_id != null ? Number(roster.roster_id) : null;
    if (rid != null) {
      originalRosters[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
    }
  }

  return { teams, originalRosters, idMap, players };
}
