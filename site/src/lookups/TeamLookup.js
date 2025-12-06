import { LEAGUE_ID, PREVIOUS_YEARS, PREVIOUS_ROSTER_OVERRIDES, teamOverrides } from '../utils/global_constants';
import { getCurrentYear } from '../utils/DateHelper';

// Helper to get avatar URL from value (ID or URL)
function getAvatarUrl(avatarVal) {
  if (!avatarVal) return null;
  if (typeof avatarVal === 'string' && avatarVal.startsWith('http')) return avatarVal;
  return `https://sleepercdn.com/avatars/${avatarVal}`;
}

export async function fetchTeamData(season = getCurrentYear()) {
  const currentYear = getCurrentYear();
  const normalizedSeason = String(season);
  const leagueId = String(currentYear) === normalizedSeason ? LEAGUE_ID : PREVIOUS_YEARS[normalizedSeason];

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

// Build a lookup map from roster_id -> { teamName, ownerName, roster, user }
export function buildRosterIdToTeamInfoMap(rosters, users) {
  const map = {};
  if (!Array.isArray(rosters) || !Array.isArray(users)) {
    return map;
  }
  for (const roster of rosters) {
    if (!roster || roster.roster_id == null) {
      continue;
    }
    const ridNum = Number(roster.roster_id);
    const ridKey = Number.isFinite(ridNum) ? ridNum : roster.roster_id;
    const ownerIdStr = roster.owner_id != null ? String(roster.owner_id) : null;
    const user = users.find((u) => {
      if (!u) { return false; }
      if (ownerIdStr && String(u.user_id) === ownerIdStr) {
        return true;
      }
      if (u.roster_id != null && Number(u.roster_id) === ridNum) {
        return true;
      }
      return false;
    }) || null;

    const ownerName = user && user.display_name ? user.display_name : null;
    let teamName = null;
    if (user && user.metadata && user.metadata.team_name) {
      teamName = user.metadata.team_name;
    } else if (ownerName) {
      teamName = `Team ${ownerName}`;
    } else {
      teamName = `Team ${ridKey}`;
    }

    map[ridKey] = {
      roster,
      user,
      teamName,
      ownerName: ownerName || `Owner ${ridKey}`,
    };
  }
  return map;
}

// Fetch traded draft picks for a given season, normalized into a simple structure
// Example item: { round: 2, season: '2025', roster_id: 1, owner_id: 4, previous_owner_id: 1 }
export async function fetchTradedPicks(season = getCurrentYear()) {
  const currentYear = getCurrentYear();
  const normalizedSeason = String(season);
  const leagueId = String(currentYear) === normalizedSeason ? LEAGUE_ID : PREVIOUS_YEARS[normalizedSeason];

  if (!leagueId) {
    throw new Error(`No league id found for season ${normalizedSeason}`);
  }

  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`);
  if (!res.ok) {
    throw new Error('Failed to fetch traded picks');
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((p) => {
    return {
      round: p && p.round != null ? Number(p.round) : null,
      season: p && p.season != null ? String(p.season) : normalizedSeason,
      roster_id: p && p.roster_id != null ? Number(p.roster_id) : null,
      owner_id: p && p.owner_id != null ? Number(p.owner_id) : null,
      previous_owner_id: p && p.previous_owner_id != null ? Number(p.previous_owner_id) : null,
    };
  });
}
