import React, { useState, useEffect } from 'react';
import { fetchTeamData } from '../lookups/TeamLookup';
import LoadingState from '../LoadingState';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

function HeadToHeadSelector({ teamIds }) {
  const [selectedTeams, setSelectedTeams] = useState(new Set());
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const myRosterId = useMyCurrentRosterId();

  useEffect(() => {
    let cancelled = false;

    async function loadTeamData() {
      if (!teamIds || teamIds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const data = await fetchTeamData();
        if (cancelled) {
          return;
        }

        const rosters = data && Array.isArray(data.rosters) ? data.rosters : [];
        const users = data && Array.isArray(data.users) ? data.users : [];

        const teams = teamIds.map((rosterId) => {
          const roster = rosters.find((r) => String(r.roster_id) === String(rosterId));
          if (!roster) {
            return {
              rosterId,
              teamName: `Team ${rosterId}`,
              avatarUrl: null,
            };
          }

          const user = users.find((u) => String(u.user_id) === String(roster.owner_id));
          let teamName = `Team ${rosterId}`;
          if (user && user.metadata && user.metadata.team_name) {
            teamName = user.metadata.team_name;
          } else if (user && user.display_name) {
            teamName = `Team ${user.display_name}`;
          }

          const avatarUrl =
            (user &&
              (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) ||
            null;

          return {
            rosterId,
            teamName,
            avatarUrl,
          };
        });

        if (!cancelled) {
          setTeamData(teams);
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTeamData();

    return () => {
      cancelled = true;
    };
  }, [teamIds]);

  const handleTeamClick = (rosterId) => {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(rosterId)) {
        next.delete(rosterId);
      } else {
        next.add(rosterId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <LoadingState label="Loading teams…" />
    );
  }

  if (!teamData || teamData.length === 0) {
    return <div>No teams found.</div>;
  }

  return (
    <div className="head-to-head-selector">
      <div className="head-to-head-instruction">
        Select 2 teams for Head to Head view
      </div>
      {teamData.map((team) => {
        const isSelected = selectedTeams.has(team.rosterId);
        const mine = isMyRoster(team.rosterId, myRosterId);
        return (
          <div
            key={team.rosterId}
            className={`head-to-head-team-box${isSelected ? ' head-to-head-team-box--selected' : ''}${mine ? ' head-to-head-team-box--me' : ''}`}
            onClick={() => handleTeamClick(team.rosterId)}
          >
            {team.avatarUrl && (
              <img
                className="standings-avatar"
                src={team.avatarUrl}
                alt={`${team.teamName} avatar`}
              />
            )}
            <span className="head-to-head-team-name">{team.teamName}</span>
          </div>
        );
      })}
    </div>
  );
}

export default HeadToHeadSelector;

