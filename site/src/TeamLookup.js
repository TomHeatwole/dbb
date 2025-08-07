import { LEAGUE_ID, PREVIOUS_YEARS, PREVIOUS_ROSTER_OVERRIDES, teamOverrides } from './global_constants';
import { getCurrentYear } from './DateHelper';

export async function fetchTeamData(season = getCurrentYear()) {
  const currentYear = getCurrentYear();
  const leagueId = currentYear === season ? LEAGUE_ID : PREVIOUS_YEARS[season];

  // Fetch rosters
  const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
  if (!rosterRes.ok) throw new Error('Failed to fetch rosters');
  const rosters = await rosterRes.json();

  // Fetch users
  const usersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
  if (!usersRes.ok) throw new Error('Failed to fetch users');
  const users = await usersRes.json();

  for (const user of users) {
    const override = PREVIOUS_ROSTER_OVERRIDES[season] && PREVIOUS_ROSTER_OVERRIDES[season][user.roster_id];
    if (override) {
      user.display_name = override.owner;
      user.metadata = { ...user.metadata, team_name: override.name };
    }
  }

  return { rosters, users };
} 