import React, { useState } from 'react';
import { OUTCOME_SCENARIO_YEARS } from './outcomeScenarioConfig';

function OutcomeScenarioSeasonDropdown({ season, onSeasonChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="team-season-dropdown" onClick={() => setOpen((o) => !o)}>
      {season}
      <span className="team-season-dropdown-arrow">{open ? '▲' : '▼'}</span>
      {open && (
        <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
          {OUTCOME_SCENARIO_YEARS.map((yr) => (
            <div
              key={yr}
              className={
                'team-season-dropdown-option' +
                (yr === season ? ' team-season-dropdown-option-active' : '')
              }
              onClick={() => {
                onSeasonChange(yr);
                setOpen(false);
              }}
            >
              {yr}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default OutcomeScenarioSeasonDropdown;
