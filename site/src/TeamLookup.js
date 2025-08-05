import { LEAGUE_ID, teamOverrides } from './global_constants';

export async function fetchTeamData(leagueId = LEAGUE_ID) {
  // Fetch rosters
  const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
  if (!rosterRes.ok) throw new Error('Failed to fetch rosters');
  const rosters = await rosterRes.json();

  // Fetch users
  const usersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
  if (!usersRes.ok) throw new Error('Failed to fetch users');
  const users = await usersRes.json();

  return { rosters, users };
} 