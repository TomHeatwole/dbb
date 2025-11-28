import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';
import { CURRENT_YEAR } from './DateHelper';
import { PREVIOUS_YEARS } from './global_constants';
import PlayoffRulesToolTip from './PlayoffRulesToolTip';
import Yoffs2024Format from './Yoffs2024Format';
import Yoffs2025Format from './Yoffs2025Format';

function YoffsPage() {
  const [season, setSeason] = useState(CURRENT_YEAR);
  const [mode, setMode] = useState('cumulative'); // 'cumulative' | 'bracket'
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const yearDropdownRef = useRef(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef(null);

  const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

  useEffect(() => {
    trackPageLoad();
  }, []);

  useEffect(() => {
    if (!yearDropdownOpen) {
      return;
    }
    const handleClickOutside = (e) => {
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(e.target)) {
        setYearDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [yearDropdownOpen]);

  useEffect(() => {
    if (!modeDropdownOpen) {
      return;
    }
    const handleClickOutside = (e) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target)) {
        setModeDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [modeDropdownOpen]);

  const leftHeader = (
    <div className="yoffs-header-filters">
      <div
        ref={yearDropdownRef}
        className="team-season-dropdown"
        onClick={() => setYearDropdownOpen(open => !open)}
      >
        {season}
        <span className="team-season-dropdown-arrow">{yearDropdownOpen ? '▲' : '▼'}</span>
        {yearDropdownOpen && (
          <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
            {allYears.map(opt => (
              <div
                key={opt}
                className={'team-season-dropdown-option' + (opt === season ? ' team-season-dropdown-option-active' : '')}
                onClick={() => {
                  setSeason(opt);
                  setYearDropdownOpen(false);
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const content = mode === 'bracket'
    ? <Yoffs2025Format season={season} />
    : <Yoffs2024Format season={season} />;

  return (
    <InfoPageWrapper
      title="Playoffs"
      subtitle={null}
      leftHeader={leftHeader}
    >
      <div className="yoffs-mode-row">
        <div className="yoffs-mode-dropdown-wrapper">
          <PlayoffRulesToolTip />
          <div
            ref={modeDropdownRef}
            className="team-season-dropdown yoffs-mode-dropdown"
            onClick={() => setModeDropdownOpen(open => !open)}
          >
            <span>
              {mode === 'cumulative' ? 'Cumulative Score (2024 rules)' : 'Bracket Format (2025 Rules)'}
            </span>
            <span className="team-season-dropdown-arrow">{modeDropdownOpen ? '▲' : '▼'}</span>
            {modeDropdownOpen && (
              <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
                <div
                  className={
                    'team-season-dropdown-option' +
                    (mode === 'bracket' ? ' team-season-dropdown-option-active' : '')
                  }
                  onClick={() => {
                    setMode('bracket');
                    setModeDropdownOpen(false);
                  }}
                >
                  Bracket Format (2025 rules)
                </div>
                <div
                  className={
                    'team-season-dropdown-option' +
                    (mode === 'cumulative' ? ' team-season-dropdown-option-active' : '')
                  }
                  onClick={() => {
                    setMode('cumulative');
                    setModeDropdownOpen(false);
                  }}
                >
                  Cumulative Score (2024 rules)
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {content}
    </InfoPageWrapper>
  );
}

export default YoffsPage;

