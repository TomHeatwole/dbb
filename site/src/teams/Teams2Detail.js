import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Navigate, useSearchParams, Link } from 'react-router-dom';
import { getPlayerInfo, fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import Teams2Overview from './Teams2Overview';
import TeamScores from '../scores/TeamScores';
import TeamAnalytics from './TeamAnalytics';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { trackPageLoad } from '../utils/UsageTracker';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import useViewportMode, { VIEWPORT_MODES } from '../hooks/useViewportMode';
import { useMyRosterId, isMyRoster } from '../hooks/useAuthUser';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function Teams2Detail() {
  const { id } = useParams();
  const viewportMode = useViewportMode();
  const isMobile = viewportMode === VIEWPORT_MODES.MOBILE;
  const [roster, setRoster] = useState(null);
  const [user, setUser] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const initialSeason = urlYear && allYears.includes(urlYear) ? urlYear : CURRENT_YEAR;
  const [season, setSeason] = useState(initialSeason);

  const tabOptions = ['Overview', 'Scores', 'Analytics'];
  const urlTabRaw = searchParams.get('tab');
  let urlTab = urlTabRaw;
  if (urlTabRaw === 'Summary' || urlTabRaw === 'Roster') {
    urlTab = 'Overview';
  } else if (urlTabRaw) {
    const matchedTab = tabOptions.find(
      option => option.toLowerCase() === urlTabRaw.toLowerCase()
    );
    urlTab = matchedTab || urlTabRaw;
  }
  const initialTab = tabOptions.includes(urlTab) ? urlTab : tabOptions[0];
  const [selectedTab, setSelectedTab] = useState(initialTab);

  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const myRosterId = useMyRosterId(rosters, users);
  const teamAnalyticsRef = useRef();
  const teamScoresRef = useRef();
  const dropdownRef = useRef(null);

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

  useEffect(() => {
    trackPageLoad();
    if (!seasonDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setSeasonDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [seasonDropdownOpen]);

  useEffect(() => {
    const changes = {};
    changes.tab = tabOptions.includes(selectedTab) ? selectedTab : 'Overview';
    if (selectedTab !== 'Scores') changes.week = null;
    if (selectedTab !== 'Analytics') {
      changes.start_week = null;
      changes.end_week = null;
    }
    updateQueryParams(changes);
    // eslint-disable-next-line
  }, [selectedTab]);

  useEffect(() => {
    if (urlTab && tabOptions.includes(urlTab) && selectedTab !== urlTab) setSelectedTab(urlTab);
    // eslint-disable-next-line
  }, [urlTab]);

  useEffect(() => {
    if (selectedTab === 'Overview') {
      updateQueryParams({ year: season === CURRENT_YEAR ? null : season });
    }
    // eslint-disable-next-line
  }, [season]);

  useEffect(() => {
    if (urlYear && allYears.includes(urlYear) && season !== urlYear) setSeason(urlYear);
    if (!urlYear && season !== CURRENT_YEAR) setSeason(CURRENT_YEAR);
    // eslint-disable-next-line
  }, [urlYear]);

  useEffect(() => {
    if (!rosters) return;
    const param = season === CURRENT_YEAR ? rosters : String(season);
    fetchPlayersData(param)
      .then(data => setPlayersData(data))
      .catch(() => setPlayersData(null));
    fetchPlayerIdMap()
      .then(setPlayerIdMap)
      .catch(() => setPlayerIdMap(null));
  }, [season, rosters]);

  useEffect(() => {
    setScoresLoading(true);
    fetchScoresData(season).then(data => {
      setWeeksParsedData(data);
      setScoresLoading(false);
    });
  }, [season]);

  useEffect(() => {
    if (!/^[1-9]\d*$/.test(id)) return;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const teamData = await fetchTeamData(season);
        let effectiveRosters = teamData.rosters;

        if (season === CURRENT_YEAR) {
          const hasAnyPlayers = teamData.rosters.some(r => r.players && r.players.length > 0);
          if (!hasAnyPlayers) {
            const prevYears = Object.keys(PREVIOUS_YEARS).map(Number).filter(n => Number.isFinite(n));
            if (prevYears.length > 0) {
              const prevYear = String(Math.max(...prevYears));
              try {
                const prevData = await fetchTeamData(prevYear);
                effectiveRosters = teamData.rosters.map(r => {
                  const prevRoster = prevData.rosters.find(pr => String(pr.roster_id) === String(r.roster_id));
                  return (prevRoster && Array.isArray(prevRoster.players) && prevRoster.players.length > 0)
                    ? { ...r, players: prevRoster.players }
                    : r;
                });
              } catch (_) {}
            }
          }
        }

        setRosters(effectiveRosters);
        setUsers(teamData.users);
        const foundRoster = effectiveRosters.find(r => String(r.roster_id) === String(id));
        setRoster(foundRoster);
        if (!foundRoster) {
          setUser(null);
          setLoading(false);
          return;
        }
        const foundUser = teamData.users.find(u => String(u.user_id) === String(foundRoster.owner_id)) ?? {};
        setUser(foundUser);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id, season]);

  // Compute quick stats
  const playerSeasonTotalsMap = useMemo(() => getPlayerSeasonTotalsMap(weeksParsedData), [weeksParsedData]);

  const quickStats = useMemo(() => {
    if (!weeksParsedData || !rosters) return null;
    const rosterId = Number(id);
    const isCurrentSeason = season === CURRENT_YEAR;
    const currentWeek = getCurrentNFLWeek(season);
    const completedWeeks = getCompletedWeeksCount(season);

    const standings = getStandings(weeksParsedData) || [];

    // Live-adjusted total
    let totalPF = 0;
    const baseStanding = standings.find(s => s.roster_id === rosterId);
    totalPF = baseStanding?.points_scored || 0;

    if (isCurrentSeason && playersData && playerIdMap) {
      try {
        const liveTotals = standings.map(s => {
          let t = s.points_scored || 0;
          const breakdown = getWeekScoreBreakdown(weeksParsedData, currentWeek) || {};
          const raw = breakdown[s.roster_id];
          if (raw) {
            const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
            if (computed && typeof computed.starterTotal === 'number') {
              const priorWeeks = (weeksParsedData || []).slice(0, currentWeek - 1);
              const priorSum = priorWeeks.reduce((sum, wk) => {
                if (!Array.isArray(wk)) return sum;
                const e = wk.find(x => x && Number(x.roster_id) === Number(s.roster_id));
                return sum + (e && typeof e.points === 'number' ? e.points : 0);
              }, 0);
              t = Math.round((priorSum + computed.starterTotal) * 10) / 10;
            }
          }
          return { roster_id: s.roster_id, total: t };
        }).sort((a, b) => b.total - a.total);

        const myLive = liveTotals.find(t => t.roster_id === rosterId);
        if (myLive) totalPF = myLive.total;

        // Live rank
        let rank = 1;
        for (const lt of liveTotals) {
          if (lt.roster_id === rosterId) break;
          rank++;
        }

        const weeksPlayed = completedWeeks > 0 ? completedWeeks : Math.max(1, currentWeek - 1);
        const ppg = weeksPlayed > 0 ? (totalPF / weeksPlayed).toFixed(1) : '0.0';

        // High/low week
        let high = { pts: -Infinity, week: null };
        let low = { pts: Infinity, week: null };
        const cap = isCurrentSeason ? Math.max(0, completedWeeks) : 17;
        for (let w = 1; w <= cap; w++) {
          const wArr = weeksParsedData[w - 1];
          if (!Array.isArray(wArr)) continue;
          const entry = wArr.find(e => e && Number(e.roster_id) === rosterId);
          const pts = entry && typeof entry.points === 'number' ? Math.round(entry.points * 10) / 10 : null;
          if (pts !== null) {
            if (pts > high.pts) high = { pts, week: w };
            if (pts < low.pts) low = { pts, week: w };
          }
        }

        return {
          rank,
          totalPF: Math.round(totalPF),
          ppg,
          highWeek: isFinite(high.pts) ? high : null,
          lowWeek: isFinite(low.pts) ? low : null,
        };
      } catch (_) {}
    }

    // Fallback for non-current or missing player data
    const sortedStandings = standings.slice().sort((a, b) => (b.points_scored || 0) - (a.points_scored || 0));
    const rank = sortedStandings.findIndex(s => s.roster_id === rosterId) + 1;
    const weeksPlayed = isCurrentSeason ? Math.max(1, completedWeeks || 1) : 17;
    const ppg = weeksPlayed > 0 ? (totalPF / weeksPlayed).toFixed(1) : '0.0';

    let high = { pts: -Infinity, week: null };
    let low = { pts: Infinity, week: null };
    const cap = isCurrentSeason ? completedWeeks : 17;
    for (let w = 1; w <= cap; w++) {
      const wArr = weeksParsedData[w - 1];
      if (!Array.isArray(wArr)) continue;
      const entry = wArr.find(e => e && Number(e.roster_id) === rosterId);
      const pts = entry && typeof entry.points === 'number' ? Math.round(entry.points * 10) / 10 : null;
      if (pts !== null) {
        if (pts > high.pts) high = { pts, week: w };
        if (pts < low.pts) low = { pts, week: w };
      }
    }

    return {
      rank: rank || '?',
      totalPF: Math.round(totalPF),
      ppg,
      highWeek: isFinite(high.pts) ? high : null,
      lowWeek: isFinite(low.pts) ? low : null,
    };
  }, [weeksParsedData, rosters, id, season, playersData, playerIdMap, playerSeasonTotalsMap]);

  if (!/^[1-9]\d*$/.test(id)) {
    return <Navigate to="/teams-2" replace />;
  }

  if (loading || !playersData || !playerIdMap || !rosters || !users) {
    return (
      <>
        <PageMeta title="Team - The Hwang Dynasty" />
        <InfoPageWrapper title="Team" subtitle={null} leftHeader={null}>
          <LoadingState label="Loading team..." />
        </InfoPageWrapper>
      </>
    );
  }
  if (error) return <div>Error: {error}</div>;
  if (!roster) return <div>No roster found for ID {id}</div>;

  const ownerName = user?.display_name || 'Unknown';
  let teamName = user?.metadata?.team_name || (ownerName !== 'Unknown' ? `Team ${ownerName}` : `Team ${id}`);
  const userAvatarUrl = user?.avatar_url;
  const teamAvatarUrl = user?.team_avatar_url || user?.user_avatar_url || userAvatarUrl;

  const playerList = (roster.players || []).map(pid => {
    const info = getPlayerInfo(pid, playersData, playerIdMap);
    return info || { name: pid, position: '', espn_photo_url: null };
  });

  const leftHeader = (
    <div
      ref={dropdownRef}
      className="team-season-dropdown"
      onClick={() => setSeasonDropdownOpen(open => !open)}
    >
      {season}
      <span className="team-season-dropdown-arrow">{seasonDropdownOpen ? '▲' : '▼'}</span>
      {seasonDropdownOpen && (
        <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
          {allYears.map(opt => (
            <div
              key={opt}
              className={'team-season-dropdown-option' + (opt === season ? ' team-season-dropdown-option-active' : '')}
              onClick={() => {
                setSeason(opt);
                setSeasonDropdownOpen(false);
                updateQueryParams({ year: opt === CURRENT_YEAR ? null : opt, start_week: null, end_week: null, week: null });
                if (teamScoresRef.current?.resetWeek) teamScoresRef.current.resetWeek(opt);
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const isPreSeason = getCompletedWeeksCount(season) === 0 && season === CURRENT_YEAR;

  return (
    <>
      <PageMeta title={`${teamName} - The Hwang Dynasty`} />
      <InfoPageWrapper leftHeader={leftHeader} title={null} subtitle={null}>
        {/* Back link */}
        <Link to={`/teams-2${season !== CURRENT_YEAR ? `?year=${season}` : ''}`} className="teams2-back-link">
          ← All Teams
        </Link>

        {/* Hero header */}
        <div className={`teams2-detail-hero${isMyRoster(id, myRosterId) ? ' teams2-detail-hero--me' : ''}`}>
          {teamAvatarUrl && (
            <img src={teamAvatarUrl} alt="" className="teams2-detail-avatar" />
          )}
          <div className="teams2-detail-hero-text">
            <h1 className="teams2-detail-team-name">
              {teamName}
              {isMyRoster(id, myRosterId) ? <span className="me-chip">YOU</span> : null}
            </h1>
            <div className="teams2-detail-owner">
              {userAvatarUrl && userAvatarUrl !== teamAvatarUrl && (
                <img src={userAvatarUrl} alt="" className="teams2-detail-owner-avatar" />
              )}
              <span>{ownerName}</span>
            </div>
          </div>
        </div>

        {/* Quick stats bar */}
        {quickStats && !isPreSeason && (
          <div className="teams2-stats-bar">
            <div className="teams2-stats-item">
              <span className="teams2-stats-value">#{quickStats.rank}</span>
              <span className="teams2-stats-label">Standing</span>
            </div>
            <div className="teams2-stats-divider" />
            <div className="teams2-stats-item">
              <span className="teams2-stats-value">{quickStats.totalPF}</span>
              <span className="teams2-stats-label">Total PF</span>
            </div>
            <div className="teams2-stats-divider" />
            <div className="teams2-stats-item">
              <span className="teams2-stats-value">{quickStats.ppg}</span>
              <span className="teams2-stats-label">PPG</span>
            </div>
            {quickStats.highWeek && (
              <>
                <div className="teams2-stats-divider" />
                <div className="teams2-stats-item">
                  <span className="teams2-stats-value teams2-stats-high">{quickStats.highWeek.pts}</span>
                  <span className="teams2-stats-label">High (W{quickStats.highWeek.week})</span>
                </div>
              </>
            )}
            {quickStats.lowWeek && !isMobile && (
              <>
                <div className="teams2-stats-divider" />
                <div className="teams2-stats-item">
                  <span className="teams2-stats-value teams2-stats-low">{quickStats.lowWeek.pts}</span>
                  <span className="teams2-stats-label">Low (W{quickStats.lowWeek.week})</span>
                </div>
              </>
            )}
          </div>
        )}

        {isPreSeason && (
          <div className="teams2-preseason-banner">Season hasn't started yet</div>
        )}

        {/* Pill tab bar */}
        <div className="teams2-tab-bar">
          {tabOptions.map(tab => (
            <button
              key={tab}
              className={`teams2-tab${selectedTab === tab ? ' teams2-tab--active' : ''}`}
              onClick={() => setSelectedTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {selectedTab === 'Overview' && (
          <Teams2Overview
            weeksParsedData={weeksParsedData}
            loading={scoresLoading}
            playersData={playersData}
            playerIdMap={playerIdMap}
            playerList={playerList}
            rosters={rosters}
            users={users}
          />
        )}
        {selectedTab === 'Scores' && (
          <TeamScores
            ref={teamScoresRef}
            weeksParsedData={weeksParsedData}
            playersData={playersData}
            playerIdMap={playerIdMap}
            updateQueryParams={updateQueryParams}
          />
        )}
        {selectedTab === 'Analytics' && (
          <TeamAnalytics
            ref={teamAnalyticsRef}
            weeksParsedData={weeksParsedData}
            teamName={teamName}
            rosters={rosters}
            users={users}
            updateQueryParams={updateQueryParams}
          />
        )}
      </InfoPageWrapper>
    </>
  );
}

export default Teams2Detail;
