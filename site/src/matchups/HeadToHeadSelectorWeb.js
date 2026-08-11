import React, { useState, useEffect } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import { useAuthUser, isMyRoster, findMyRosterId } from '../hooks/useAuthUser';

function HeadToHeadSelectorWeb({
  teams,
  initialSelection = null,
  onSelectionChange = null,
  usePlayoffTheme = true,
  enableMobileSelectorCollapse = false,
  myRosterId: myRosterIdProp = null,
  rosters = null,
  users = null,
}) {
  // Explicit slots so Team A/B positions don't shift when unselecting.
  // selectedSlots[0] -> Team A, selectedSlots[1] -> Team B
  const [selectedSlots, setSelectedSlots] = useState(
    Array.isArray(initialSelection) && initialSelection.length === 2
      ? initialSelection
      : [null, null]
  );

  const isMobile = useIsMobile();
  const { user: authUser } = useAuthUser();
  const myRosterId = myRosterIdProp != null ? myRosterIdProp : findMyRosterId(rosters, users, authUser);
  const isMobileCollapseActive = enableMobileSelectorCollapse && isMobile;

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
  const isCollapsed = isMobileCollapseActive && selectionFull;

  const visibleTeams = isCollapsed
    ? teams.filter((team) => selectedSlots.includes(team.rosterId))
    : teams;

  return (
    <div className="h2h-web-root">
      <div className="h2h-web-instruction">
        {isCollapsed
          ? 'Unselect a team to pick a different matchup'
          : 'Select 2 teams for Head to Head view'}
      </div>
      <div
        className={
          'h2h-web-list-anim-shell' +
          (isCollapsed ? ' h2h-web-list-anim-shell--collapsed-mobile' : '')
        }
      >
        <div className="h2h-web-list">
          {visibleTeams.map((team) => {
            const isSelected = selectedSlots.includes(team.rosterId);
            const isDisabled = selectionFull && !isSelected;
            const mine = isMyRoster(team.rosterId, myRosterId);
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
                  (mine ? ' h2h-web-card--me' : '') +
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
                  {mine ? <span className="me-chip">YOU</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default HeadToHeadSelectorWeb;


