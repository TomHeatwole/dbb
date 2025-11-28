import React, { useEffect, useRef } from 'react';

const NUM_WEEKS = 17;

export default function WeekSelector({ week, onChange, className = '', minWeek = 1, maxWeek = NUM_WEEKS }) {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!dropdownOpen) { return; }
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

  useEffect(() => { setDropdownOpen(false); }, [week]);

  const handleArrow = (dir) => {
    const lower = Math.max(1, minWeek);
    const upper = Math.min(NUM_WEEKS, Math.max(lower, maxWeek));
    const next = Math.max(lower, Math.min(upper, week + dir));
    if (next !== week) { onChange(next); }
  };

  const handleSelect = (w) => {
    onChange(w);
    setDropdownOpen(false);
  };

  const lower = Math.max(1, minWeek);
  const upper = Math.min(NUM_WEEKS, Math.max(lower, maxWeek));
  const weekOptions = [];
  for (let w = lower; w <= upper; w += 1) {
    weekOptions.push(w);
  }

  return (
    <div className={`team-scores-week-bar ${className}`}>
      <button className="team-scores-arrow" onClick={() => handleArrow(-1)} disabled={week === lower} aria-label="Previous Week">&#8592;</button>
      <div className="team-scores-week-dropdown" onClick={() => setDropdownOpen(open => !open)} ref={dropdownRef}>
        Week {week}
        <span className="team-scores-week-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
        {dropdownOpen && (
          <div className="team-scores-week-dropdown-list">
            {weekOptions.map((w) => (
              <div
                key={w}
                className={
                  'team-scores-week-dropdown-option' +
                  (week === w ? ' team-scores-week-dropdown-option-active' : '')
                }
                onClick={() => handleSelect(w)}
              >
                Week {w}
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="team-scores-arrow" onClick={() => handleArrow(1)} disabled={week === upper} aria-label="Next Week">&#8594;</button>
    </div>
  );
} 