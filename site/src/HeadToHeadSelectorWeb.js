import React, { useState } from 'react';

function HeadToHeadSelectorWeb({ teams, onSelectionChange = null }) {
  const [selectedOrder, setSelectedOrder] = useState([]);

  const handleToggle = (rosterId) => {
    setSelectedOrder((prev) => {
      let next;
      if (prev.includes(rosterId)) {
        // Deselect: remove from order
        next = prev.filter((id) => id !== rosterId);
      } else if (prev.length >= 2) {
        // Already have 2 selected; ignore new clicks
        next = prev;
      } else {
        next = [...prev, rosterId];
      }
      if (onSelectionChange) {
        onSelectionChange(next);
      }
      return next;
    });
  };

  if (!teams || teams.length === 0) {
    return <div>No playoff teams found for this season.</div>;
  }

  const teamA =
    selectedOrder.length > 0
      ? teams.find((t) => t.rosterId === selectedOrder[0]) || null
      : null;
  const teamB =
    selectedOrder.length > 1
      ? teams.find((t) => t.rosterId === selectedOrder[1]) || null
      : null;
  const selectionFull = selectedOrder.length >= 2;

  return (
    <div className="h2h-web-root">
      <div className="h2h-web-instruction">
        Select 2 teams for Head to Head view
      </div>
      <div className="h2h-web-list">
        {teams.map((team) => {
          const isSelected = selectedOrder.includes(team.rosterId);
          const isDisabled = selectionFull && !isSelected;
          return (
            <button
              key={team.rosterId}
              type="button"
              className={
                'h2h-web-card' +
                (isSelected ? ' h2h-web-card--selected' : '') +
                (isDisabled ? ' h2h-web-card--disabled' : '')
              }
              disabled={isDisabled}
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
      <div className="h2h-web-summary">
        <div className="h2h-web-summary-item">
          <span className="h2h-web-summary-label">Team A:</span>
          <span className="h2h-web-summary-value">
            {teamA ? teamA.teamName : 'NONE'}
          </span>
        </div>
        <div className="h2h-web-summary-item">
          <span className="h2h-web-summary-label">Team B:</span>
          <span className="h2h-web-summary-value">
            {teamB ? teamB.teamName : 'NONE'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default HeadToHeadSelectorWeb;


