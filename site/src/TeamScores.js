import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const NUM_WEEKS = 17;

function TeamScores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlWeek = parseInt(searchParams.get('week'), 10);
  const initialWeek = !isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS ? urlWeek : 1;
  const [week, setWeek] = useState(initialWeek);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Update query param when week changes
  useEffect(() => {
    if (week === 1) {
      searchParams.delete('week');
      setSearchParams(searchParams, { replace: true });
    } else {
      searchParams.set('week', week);
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line
  }, [week]);

  // Update week if query param changes (browser nav)
  useEffect(() => {
    if (!isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS && week !== urlWeek) setWeek(urlWeek);
    if ((isNaN(urlWeek) || urlWeek < 1 || urlWeek > NUM_WEEKS) && week !== 1) setWeek(1);
    // eslint-disable-next-line
  }, [urlWeek]);

  const handleArrow = dir => {
    setWeek(w => Math.max(1, Math.min(NUM_WEEKS, w + dir)));
  };

  const handleSelect = w => {
    setWeek(w);
    setDropdownOpen(false);
  };

  return (
    <div className="team-scores-container">
      <div className="team-scores-week-bar">
        <button
          className="team-scores-arrow"
          onClick={() => handleArrow(-1)}
          disabled={week === 1}
          aria-label="Previous Week"
        >
          &#8592;
        </button>
        <div
          className="team-scores-week-dropdown"
          onClick={() => setDropdownOpen(open => !open)}
        >
          Week {week}
          <span className="team-scores-week-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
          {dropdownOpen && (
            <div className="team-scores-week-dropdown-list">
              {[...Array(NUM_WEEKS)].map((_, i) => (
                <div
                  key={i + 1}
                  className={
                    'team-scores-week-dropdown-option' +
                    (week === i + 1 ? ' team-scores-week-dropdown-option-active' : '')
                  }
                  onClick={() => handleSelect(i + 1)}
                >
                  Week {i + 1}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className="team-scores-arrow"
          onClick={() => handleArrow(1)}
          disabled={week === NUM_WEEKS}
          aria-label="Next Week"
        >
          &#8594;
        </button>
      </div>
      {/* Week content will go here */}
    </div>
  );
}

export default TeamScores; 