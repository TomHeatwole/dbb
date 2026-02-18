import React from 'react';

/**
 * Renders the league teams in a grid similar to the h2h selector.
 * Single-selection: clicking a team opens its roster editor.
 * Clicking the selected team again deselects it.
 */
function ScenarioTeamGrid({ teams, selectedRosterId, onSelectTeam }) {
  if (!teams || teams.length === 0) {
    return <div>No teams found.</div>;
  }

  return (
    <div className="scenario-team-grid-root">
      <div className="h2h-web-instruction">Select a team to edit its roster</div>
      <div className="h2h-web-list-anim-shell">
        <div className="h2h-web-list">
          {teams.map((team) => {
            const isSelected = team.rosterId === selectedRosterId;
            return (
              <button
                key={team.rosterId}
                type="button"
                className={
                  'h2h-web-card' +
                  (isSelected ? ' h2h-web-card--selected-primary' : '')
                }
                onClick={() => onSelectTeam(isSelected ? null : team.rosterId)}
              >
                {team.avatarUrl && (
                  <img
                    className="standings-avatar h2h-web-avatar"
                    src={team.avatarUrl}
                    alt={`${team.teamName} avatar`}
                  />
                )}
                <span className="yoffs-bracket-name h2h-web-name">
                  {team.teamName}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ScenarioTeamGrid;
