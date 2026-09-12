import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { trackPageLoad } from '../utils/UsageTracker';
import { CURRENT_YEAR, getCompletedWeeksCount, isPreSeason } from '../utils/DateHelper';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import PlayoffRulesToolTip from '../yoffs/PlayoffRulesToolTip';
import Yoffs2024Format from '../yoffs/Yoffs2024Format';
import Yoffs2025Format from '../yoffs/Yoffs2025Format';
import { useSearchParams } from 'react-router-dom';
import PageMeta from '../PageMeta';
import {
  PLAYOFF_FORMAT_BRACKET,
  PLAYOFF_FORMAT_CUMULATIVE,
  PLAYOFF_FORMATS,
  playoffFormatForSeason,
} from '../scenarios/playoffStandings';

const PLAYOFF_START_WEEK = 15;
const PLAYOFF_END_WEEK = 17;
const OG_TITLE = 'Playoffs – The Hwang Dynasty';
const OG_DESCRIPTION = '';
const OG_IMAGE = `${process.env.PUBLIC_URL || ''}/og_playoffs.png`;

function YoffsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const urlFormat = searchParams.get('format');
  const urlTab = searchParams.get('tab');
  const urlTeamA = searchParams.get('a');
  const urlTeamB = searchParams.get('b');

  const preseason = isPreSeason();
  const prevYearsForDefault = Object.keys(PREVIOUS_YEARS).sort((a, b) => b - a);
  const availableYears = preseason ? prevYearsForDefault : [CURRENT_YEAR, ...prevYearsForDefault];
  const defaultSeason = preseason && prevYearsForDefault.length > 0 ? prevYearsForDefault[0] : CURRENT_YEAR;
  const initialSeason = urlYear && String(urlYear) !== 'null' ? urlYear : defaultSeason;
  const initialModeFromUrl =
    urlFormat === 'bracket' || urlFormat === 'cumulative' ? urlFormat : null;
  const initialMode = initialModeFromUrl || playoffFormatForSeason(initialSeason);

  function getTabOptionsForMode(modeValue) {
    if (modeValue === 'bracket') {
      return ['Bracket', 'Scores', 'Matchups'];
    }
    return ['Overview', 'Scores', 'Head to Head'];
  }

  const initialTabOptions = getTabOptionsForMode(initialMode);
  
  // Normalize tab parameter (case-insensitive matching)
  let normalizedUrlTab = urlTab;
  if (urlTab) {
    const matchedTab = initialTabOptions.find(
      option => option.toLowerCase() === urlTab.toLowerCase()
    );
    normalizedUrlTab = matchedTab || urlTab;
  }
  
  const initialTab = normalizedUrlTab && initialTabOptions.includes(normalizedUrlTab) 
    ? normalizedUrlTab 
    : initialTabOptions[0];

  const [season, setSeason] = useState(initialSeason);
  const [mode, setMode] = useState(initialMode); // 'cumulative' | 'bracket'
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const yearDropdownRef = useRef(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef(null);
  const [selectedTab, setSelectedTab] = useState(initialTab);

  // availableYears and defaultSeason already computed above

  useEffect(() => {
    trackPageLoad();
  }, []);

  const [h2hSelectedIds, setH2hSelectedIds] = useState([null, null]);

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
    if (safeTab !== 'Head to Head') {
      changes.a = null;
      changes.b = null;
      setH2hSelectedIds([null, null]);
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

  // Keep Head-to-Head selection in sync with URL params (back/forward nav).
  useEffect(() => {
    const nextA = urlTeamA ? Number(urlTeamA) : null;
    const nextB = urlTeamB ? Number(urlTeamB) : null;
    setH2hSelectedIds((prev) => {
      if (prev[0] === nextA && prev[1] === nextB) {
        return prev;
      }
      return [nextA, nextB];
    });
  }, [urlTeamA, urlTeamB]);

  const handleHeadToHeadSelectionChange = React.useCallback((nextSlots) => {
    const safe = Array.isArray(nextSlots) ? nextSlots.slice(0, 2) : [null, null];
    while (safe.length < 2) {
      safe.push(null);
    }
    setH2hSelectedIds(safe);
    const [teamA, teamB] = safe;
    updateQueryParams({
      a: teamA != null ? teamA : null,
      b: teamB != null ? teamB : null,
    });
  }, [updateQueryParams]);

  // React to external URL changes (browser nav) for year/format
  useEffect(() => {
    if (urlYear && urlYear !== season) {
      setSeason(urlYear);
    } else if (!urlYear && season !== defaultSeason) {
      setSeason(defaultSeason);
    }
    if (urlFormat && urlFormat !== mode && (urlFormat === 'bracket' || urlFormat === 'cumulative')) {
      setMode(urlFormat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlYear, urlFormat]);

  // React to external URL tab changes (browser nav) when valid for current mode
  useEffect(() => {
    const tabOptions = getTabOptionsForMode(mode);
    if (urlTab) {
      // Case-insensitive match
      const matchedTab = tabOptions.find(
        option => option.toLowerCase() === urlTab.toLowerCase()
      );
      if (matchedTab && selectedTab !== matchedTab) {
        setSelectedTab(matchedTab);
      }
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
            {availableYears.map(opt => (
              <div
                key={opt}
                className={'team-season-dropdown-option' + (opt === season ? ' team-season-dropdown-option-active' : '')}
                onClick={() => {
                  // User explicitly changed season via dropdown: update state and query params.
                  const nextSeason = opt;
                  const nextMode = playoffFormatForSeason(nextSeason);
                  const tabOptionsForNext = getTabOptionsForMode(nextMode);
                  const nextTab = tabOptionsForNext[0];

                  setSeason(nextSeason);
                  setMode(nextMode);
                  setSelectedTab(nextTab);
                  setYearDropdownOpen(false);

                  updateQueryParams({
                    year: String(nextSeason) === String(defaultSeason) ? null : nextSeason,
                    format: nextMode,
                    tab: nextTab,
                    matchup: null,
                    a: null,
                    b: null,
                  });
                  setH2hSelectedIds([null, null]);
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
        h2hSelectedIds={h2hSelectedIds}
        onH2hSelectedIdsChange={handleHeadToHeadSelectionChange}
      />
    );

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} image={OG_IMAGE} />
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
              {PLAYOFF_FORMATS[mode === PLAYOFF_FORMAT_BRACKET
                ? PLAYOFF_FORMAT_BRACKET
                : PLAYOFF_FORMAT_CUMULATIVE].label}
            </span>
            <span className="team-season-dropdown-arrow">{modeDropdownOpen ? '▲' : '▼'}</span>
            {modeDropdownOpen && (
              <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
                <div
                  className={
                    'team-season-dropdown-option' +
                    (mode === PLAYOFF_FORMAT_CUMULATIVE ? ' team-season-dropdown-option-active' : '')
                  }
                  onClick={() => {
                    const nextMode = PLAYOFF_FORMAT_CUMULATIVE;
                    const tabOptionsForNext = getTabOptionsForMode(nextMode);
                    const nextTab = tabOptionsForNext[0];
                    setMode(nextMode);
                    setSelectedTab(nextTab);
                    setModeDropdownOpen(false);
                    updateQueryParams({ format: nextMode, tab: nextTab, matchup: null, a: null, b: null });
                    setH2hSelectedIds([null, null]);
                  }}
                >
                  {PLAYOFF_FORMATS[PLAYOFF_FORMAT_CUMULATIVE].label}
                </div>
                <div
                  className={
                    'team-season-dropdown-option' +
                    (mode === PLAYOFF_FORMAT_BRACKET ? ' team-season-dropdown-option-active' : '')
                  }
                  onClick={() => {
                    const nextMode = PLAYOFF_FORMAT_BRACKET;
                    const tabOptionsForNext = getTabOptionsForMode(nextMode);
                    const nextTab = tabOptionsForNext[0];
                    setMode(nextMode);
                    setSelectedTab(nextTab);
                    setModeDropdownOpen(false);
                    updateQueryParams({ format: nextMode, tab: nextTab, matchup: null, a: null, b: null });
                    setH2hSelectedIds([null, null]);
                  }}
                >
                  {PLAYOFF_FORMATS[PLAYOFF_FORMAT_BRACKET].label}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {content}
    </InfoPageWrapper>
    </>
  );
}

export default YoffsPage;

