import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';
import { CURRENT_YEAR, getCompletedWeeksCount } from './DateHelper';
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
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const yearDropdownRef = useRef(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef(null);
  const [selectedTab, setSelectedTab] = useState(initialTab);

  const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

  useEffect(() => {
    trackPageLoad();
  }, []);

  const updateQueryParams = React.useCallback((changes) => {
    const newParams = new URLSearchParams(searchParams);
    Object.keys(changes || {}).forEach((key) => {
      const val = changes[key];
      if (val === null || val === undefined || val === '') {
        newParams.delete(key);
      } else {
        newParams.set(key, String(val));
      }
    });
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleTabChange = React.useCallback((tab) => {
    const tabOptions = getTabOptionsForMode(mode);
    const safeTab = tabOptions.includes(tab) ? tab : tabOptions[0];
    setSelectedTab(safeTab);
    const changes = { tab: safeTab };
    if (safeTab !== 'Matchups') {
      changes.matchup = null;
    }
    updateQueryParams(changes);
  }, [mode, updateQueryParams]);

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

  const playoffSeedLockWeek = PLAYOFF_START_WEEK - 1;
  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const completedWeeksForSeason = isCurrentSeason ? getCompletedWeeksCount(CURRENT_YEAR) : null;
  const showPlayoffPictureWarning =
    isCurrentSeason &&
    Number.isFinite(completedWeeksForSeason) &&
    completedWeeksForSeason < playoffSeedLockWeek;
  const playoffsStarted =
    !isCurrentSeason ||
    (Number.isFinite(completedWeeksForSeason) &&
      completedWeeksForSeason >= PLAYOFF_START_WEEK);

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

  // React to external URL tab changes (browser nav) when valid for current mode
  useEffect(() => {
    const tabOptions = getTabOptionsForMode(mode);
    if (urlTab && tabOptions.includes(urlTab) && selectedTab !== urlTab) {
      setSelectedTab(urlTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab, mode]);

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
                  // User explicitly changed season via dropdown: update state and query params.
                  const nextSeason = opt;
                  let nextMode = mode;
                  if (String(nextSeason) === '2024') {
                    nextMode = 'cumulative';
                  } else {
                    nextMode = 'bracket';
                  }
                  const tabOptionsForNext = getTabOptionsForMode(nextMode);
                  const nextTab = tabOptionsForNext[0];

                  setSeason(nextSeason);
                  setMode(nextMode);
                  setSelectedTab(nextTab);
                  setYearDropdownOpen(false);

                  updateQueryParams({
                    year: String(nextSeason) === String(CURRENT_YEAR) ? null : nextSeason,
                    format: nextMode,
                    tab: nextTab,
                    matchup: null,
                  });
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
        onTabChange={handleTabChange}
        playoffStartWeek={PLAYOFF_START_WEEK}
        playoffEndWeek={PLAYOFF_END_WEEK}
        showPlayoffPictureWarning={showPlayoffPictureWarning}
        playoffSeedLockWeek={playoffSeedLockWeek}
        playoffsStarted={playoffsStarted}
      />
    )
    : (
      <Yoffs2024Format
        season={season}
        selectedTab={selectedTab}
        onTabChange={handleTabChange}
        playoffStartWeek={PLAYOFF_START_WEEK}
        playoffEndWeek={PLAYOFF_END_WEEK}
        showPlayoffPictureWarning={showPlayoffPictureWarning}
        playoffSeedLockWeek={playoffSeedLockWeek}
        playoffsStarted={playoffsStarted}
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
                    // User explicitly chose bracket format; update mode, tab, and query params.
                    const nextMode = 'bracket';
                    const tabOptionsForNext = getTabOptionsForMode(nextMode);
                    const nextTab = tabOptionsForNext[0];
                    setMode(nextMode);
                    setSelectedTab(nextTab);
                    setModeDropdownOpen(false);
                    updateQueryParams({ format: nextMode, tab: nextTab, matchup: null });
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
                    // User explicitly chose cumulative format; update mode, tab, and query params.
                    const nextMode = 'cumulative';
                    const tabOptionsForNext = getTabOptionsForMode(nextMode);
                    const nextTab = tabOptionsForNext[0];
                    setMode(nextMode);
                    setSelectedTab(nextTab);
                    setModeDropdownOpen(false);
                    updateQueryParams({ format: nextMode, tab: nextTab, matchup: null });
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

