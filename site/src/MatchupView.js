import React, { useEffect, useState } from 'react';
import { fetchTeamData } from './TeamLookup';

function resolveTeamMeta(teamData, rosterId) {
  if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
    return { teamName: `Team ${rosterId}`, avatarUrl: null };
  }

  const roster = teamData.rosters.find(
    (r) => String(r.roster_id) === String(rosterId)
  );
  const user = roster
    ? teamData.users.find(
        (u) => String(u.user_id) === String(roster.owner_id)
      )
    : null;

  let teamName = `Team ${rosterId}`;
  if (user && user.metadata && user.metadata.team_name) {
    teamName = user.metadata.team_name;
  } else if (user && user.display_name) {
    teamName = `Team ${user.display_name}`;
  }

  const avatarUrl =
    (user &&
      (user.team_avatar_url ||
        user.user_avatar_url ||
        user.avatar_url)) ||
    null;

  return { teamName, avatarUrl };
}

/**
 * MatchupView
 *
 * Props:
 * - season: string | number (ESPN/Sleeper season identifier)
 * - team1Id: roster_id for the left team
 * - team2Id: roster_id for the right team
 * - week: number (current matchup week; not yet used for scoring)
 * - displaySeeds: boolean (optional) – if true, show seeds before team names
 * - seed1: number (optional) – seed for team1
 * - seed2: number (optional) – seed for team2
 */
function MatchupView({ season, team1Id, team2Id, week, displaySeeds = false, seed1 = null, seed2 = null }) {
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTeamData(season);
        if (!cancelled) {
          setTeamData(data);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load team data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTeams();

    return () => {
      cancelled = true;
    };
  }, [season]);

  const leftMeta = resolveTeamMeta(teamData, team1Id);
  const rightMeta = resolveTeamMeta(teamData, team2Id);

  if (loading) {
    return (
      <div className="yoffs-matchup-view loading-center">
        <div className="spinner" aria-label="Loading matchup" />
      </div>
    );
  }

  if (error) {
    return <div className="yoffs-matchup-view-error">{error}</div>;
  }

  return (
    <div className="yoffs-matchup-view">
      <div className="yoffs-matchup-side yoffs-matchup-side--left">
        <div className="yoffs-bracket-team">
          {displaySeeds && seed1 != null && (
            <span className="yoffs-bracket-seed">#{seed1}</span>
          )}
          {leftMeta.avatarUrl && (
            <img
              className="standings-avatar"
              src={leftMeta.avatarUrl}
              alt={`${leftMeta.teamName} avatar`}
            />
          )}
          <span className="yoffs-bracket-name">{leftMeta.teamName}</span>
        </div>
      </div>
      <div className="yoffs-matchup-center">
        <span className="yoffs-matchup-week-label">Week {week}</span>
      </div>
      <div className="yoffs-matchup-side yoffs-matchup-side--right">
        <div className="yoffs-bracket-team">
          {displaySeeds && seed2 != null && (
            <span className="yoffs-bracket-seed">#{seed2}</span>
          )}
          {rightMeta.avatarUrl && (
            <img
              className="standings-avatar"
              src={rightMeta.avatarUrl}
              alt={`${rightMeta.teamName} avatar`}
            />
          )}
          <span className="yoffs-bracket-name">{rightMeta.teamName}</span>
        </div>
      </div>
    </div>
  );
}

export default MatchupView;


