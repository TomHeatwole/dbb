import React, { useState } from 'react';

function HeadToHeadSelectorWeb({ teams }) {
  const [selectedIds, setSelectedIds] = useState(new Set());

  const handleToggle = (rosterId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rosterId)) {
        next.delete(rosterId);
      } else {
        next.add(rosterId);
      }
      return next;
    });
  };

  if (!teams || teams.length === 0) {
    return <div>No playoff teams found for this season.</div>;
  }

  return (
    <div className="h2h-web-root">
      <div className="h2h-web-instruction">
        Select 2 teams for Head to Head view
      </div>
      <div className="h2h-web-list">
        {teams.map((team) => {
          const isSelected = selectedIds.has(team.rosterId);
          return (
            <button
              key={team.rosterId}
              type="button"
              className={
                'h2h-web-card' +
                (isSelected ? ' h2h-web-card--selected' : '')
              }
              onClick={() => handleToggle(team.rosterId)}
            >
              <span className="yoffs-bracket-seed">
                #{team.seed != null ? team.seed : team.displaySeed}
              </span>
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
  );
}

export default HeadToHeadSelectorWeb;


