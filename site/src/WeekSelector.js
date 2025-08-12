import React, { useEffect, useRef } from 'react';

const NUM_WEEKS = 17;

export default function WeekSelector({ week, onChange, className = '' }) {
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
    const next = Math.max(1, Math.min(NUM_WEEKS, week + dir));
    if (next !== week) { onChange(next); }
  };

  const handleSelect = (w) => {
    onChange(w);
    setDropdownOpen(false);
  };

  return (
    <div className={`team-scores-week-bar ${className}`}>
      <button className="team-scores-arrow" onClick={() => handleArrow(-1)} disabled={week === 1} aria-label="Previous Week">&#8592;</button>
      <div className="team-scores-week-dropdown" onClick={() => setDropdownOpen(open => !open)} ref={dropdownRef}>
        Week {week}
        <span className="team-scores-week-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
        {dropdownOpen && (
          <div className="team-scores-week-dropdown-list">
            {[...Array(NUM_WEEKS)].map((_, i) => (
              <div key={i + 1} className={'team-scores-week-dropdown-option' + (week === i + 1 ? ' team-scores-week-dropdown-option-active' : '')} onClick={() => handleSelect(i + 1)}>
                Week {i + 1}
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="team-scores-arrow" onClick={() => handleArrow(1)} disabled={week === NUM_WEEKS} aria-label="Next Week">&#8594;</button>
    </div>
  );
} 