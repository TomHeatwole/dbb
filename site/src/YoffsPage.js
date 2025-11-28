import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';
import { CURRENT_YEAR } from './DateHelper';
import { PREVIOUS_YEARS } from './global_constants';
import PlayoffRulesToolTip from './PlayoffRulesToolTip';
import Yoffs2024Format from './Yoffs2024Format';
import Yoffs2025Format from './Yoffs2025Format';
import { useSearchParams } from 'react-router-dom';

const PLAYOFF_START_WEEK = 15;
const PLAYOFF_END_WEEK = 17;

function YoffsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const urlFormat = searchParams.get('format');
  const urlTab = searchParams.get('tab');

  const initialSeason = urlYear && String(urlYear) !== 'null' ? urlYear : CURRENT_YEAR;
  const initialModeFromUrl =
    urlFormat === 'bracket' || urlFormat === 'cumulative' ? urlFormat : null;
  const initialMode = initialModeFromUrl || (initialSeason === '2024' ? 'cumulative' : 'bracket');

  function getTabOptionsForMode(modeValue) {
    if (modeValue === 'bracket') {
      return ['Bracket', 'Scores', 'Matchups'];
    }
    return ['Overview', 'Scores', 'Head to Head'];
  }

  const initialTabOptions = getTabOptionsForMode(initialMode);
  const initialTab = urlTab && initialTabOptions.includes(urlTab) ? urlTab : initialTabOptions[0];

  const [season, setSeason] = useState(initialSeason);
  const [mode, setMode] = useState(initialMode); // 'cumulative' | 'bracket'
  const [hasAppliedInitialSeasonDefault, setHasAppliedInitialSeasonDefault] = useState(false);
  const [hasAppliedInitialTabDefault, setHasAppliedInitialTabDefault] = useState(false);
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const yearDropdownRef = useRef(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef(null);
  const [selectedTab, setSelectedTab] = useState(initialTab);

  const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

  useEffect(() => {
    trackPageLoad();
  }, []);

  // When the season changes (via user dropdown), choose an initial/default playoff format,
  // but only after the first render. On first render we respect any explicit format in the URL.
  useEffect(() => {
    if (!hasAppliedInitialSeasonDefault) {
      setHasAppliedInitialSeasonDefault(true);
      return;
    }
    if (season === '2024') {
      if (mode !== 'cumulative') {
        setMode('cumulative');
      }
    } else if (mode !== 'bracket') {
      setMode('bracket');
    }
    // we intentionally only react to season changes, not mode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, hasAppliedInitialSeasonDefault]);

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

  // Keep year/format in sync with query params
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    if (season && String(season) !== String(CURRENT_YEAR)) {
      newParams.set('year', String(season));
    } else {
      newParams.delete('year');
    }
    if (mode === 'bracket' || mode === 'cumulative') {
      newParams.set('format', mode);
    } else {
      newParams.delete('format');
    }
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, mode]);

  // React to external URL changes (browser nav) for year/format
  useEffect(() => {
    if (urlYear && urlYear !== season) {
      setSeason(urlYear);
    } else if (!urlYear && season !== CURRENT_YEAR) {
      setSeason(CURRENT_YEAR);
    }
    if (urlFormat && urlFormat !== mode && (urlFormat === 'bracket' || urlFormat === 'cumulative')) {
      setMode(urlFormat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlYear, urlFormat]);

  // Sync tab with query params whenever selectedTab or mode changes
  useEffect(() => {
    const tabOptions = getTabOptionsForMode(mode);
    const safeTab = tabOptions.includes(selectedTab) ? selectedTab : tabOptions[0];
    const newParams = new URLSearchParams(searchParams);
    if (safeTab) {
      newParams.set('tab', safeTab);
    } else {
      newParams.delete('tab');
    }
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, mode]);

  // React to external URL tab changes (browser nav) when valid for current mode
  useEffect(() => {
    const tabOptions = getTabOptionsForMode(mode);
    if (urlTab && tabOptions.includes(urlTab) && selectedTab !== urlTab) {
      setSelectedTab(urlTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab, mode]);

  // Default tab to leftmost when season or mode changes, but only after first render
  useEffect(() => {
    if (!hasAppliedInitialTabDefault) {
      setHasAppliedInitialTabDefault(true);
      return;
    }
    const tabOptions = getTabOptionsForMode(mode);
    const defaultTab = tabOptions[0];
    if (selectedTab !== defaultTab) {
      setSelectedTab(defaultTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, mode, hasAppliedInitialTabDefault]);

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
    ? (
      <Yoffs2025Format
        season={season}
        selectedTab={selectedTab}
        onTabChange={setSelectedTab}
        playoffStartWeek={PLAYOFF_START_WEEK}
        playoffEndWeek={PLAYOFF_END_WEEK}
      />
    )
    : (
      <Yoffs2024Format
        season={season}
        selectedTab={selectedTab}
        onTabChange={setSelectedTab}
        playoffStartWeek={PLAYOFF_START_WEEK}
        playoffEndWeek={PLAYOFF_END_WEEK}
      />
    );

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

