import { LEAGUE_ID, PREVIOUS_YEARS, PREVIOUS_ROSTER_OVERRIDES, teamOverrides } from './global_constants';
import { getCurrentYear } from './DateHelper';

// Helper to get avatar URL from value (ID or URL)
function getAvatarUrl(avatarVal) {
  if (!avatarVal) return null;
  if (typeof avatarVal === 'string' && avatarVal.startsWith('http')) return avatarVal;
  return `https://sleepercdn.com/avatars/${avatarVal}`;
}

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

  for (const roster of rosters) {
    const override = PREVIOUS_ROSTER_OVERRIDES[season] && PREVIOUS_ROSTER_OVERRIDES[season][roster.roster_id];
    if (override) {
      users.push(
        {
          display_name: override.owner,
          metadata: {
            team_name: override.name
          },
          avatar: override.avatar,
          roster_id: roster.roster_id,
          user_id: roster.owner_id,
        }
      )
    }
  }

  for (const user of users) {
    const userAvatarUrl = getAvatarUrl(user.avatar);
    const teamMetaAvatar = user && user.metadata ? (user.metadata.avatar || user.metadata.team_avatar) : null;
    const teamAvatarUrl = getAvatarUrl(teamMetaAvatar);
    // Preserve existing field for backward-compat
    user.avatar_url = userAvatarUrl;
    // New explicit fields
    user.user_avatar_url = userAvatarUrl;
    user.team_avatar_url = teamAvatarUrl;
  }

  return { rosters, users };
} 
