import React, { useState, useEffect } from 'react';

function HeadToHeadSelectorWeb({
  teams,
  initialSelection = null,
  onSelectionChange = null,
  usePlayoffTheme = true
}) {
  // Explicit slots so Team A/B positions don't shift when unselecting.
  // selectedSlots[0] -> Team A, selectedSlots[1] -> Team B
  const [selectedSlots, setSelectedSlots] = useState(
    Array.isArray(initialSelection) && initialSelection.length === 2
      ? initialSelection
      : [null, null]
  );

  useEffect(() => {
    if (Array.isArray(initialSelection) && initialSelection.length === 2) {
      setSelectedSlots(initialSelection);
    } else {
      setSelectedSlots([null, null]);
    }
  }, [initialSelection]);

  const handleToggle = (rosterId) => {
    setSelectedSlots((prev) => {
      const next = [...prev];
      const existingIdx = prev.findIndex((id) => id === rosterId);

      if (existingIdx !== -1) {
        // Deselect: clear that specific slot, do NOT shift the other team.
        next[existingIdx] = null;
      } else {
        // Select: fill the first open slot (Team A first, then Team B).
        const openIdx = prev.findIndex((id) => id == null);
        if (openIdx === -1) {
          // Already have 2 selected; ignore new clicks
          return prev;
        }
        next[openIdx] = rosterId;
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

  const selectionFull = selectedSlots.every((id) => id != null);

  return (
    <div className="h2h-web-root">
      <div className="h2h-web-instruction">
        Select 2 teams for Head to Head view
      </div>
      <div className="h2h-web-list">
        {teams.map((team) => {
          const isSelected = selectedSlots.includes(team.rosterId);
          const isDisabled = selectionFull && !isSelected;
          const selectedClass = isSelected
            ? (usePlayoffTheme ? ' h2h-web-card--selected' : ' h2h-web-card--selected-primary')
            : '';
          const rawSeed = team.seed != null ? team.seed : team.displaySeed;
          const showSeedPill = usePlayoffTheme && rawSeed != null;
          return (
            <button
              key={team.rosterId}
              type="button"
              className={
                'h2h-web-card' +
                selectedClass +
                (isDisabled ? ' h2h-web-card--disabled' : '')
              }
              disabled={isDisabled}
              onClick={() => handleToggle(team.rosterId)}
            >
              {showSeedPill && (
                <span className="yoffs-bracket-seed">
                  {`#${rawSeed}`}
                </span>
              )}
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


