import React, { useEffect, useState, useRef } from 'react';
import { useParams, Navigate, useSearchParams } from 'react-router-dom';
import { getPlayerInfo, fetchPlayersData, fetchPlayerIdMap } from './PlayerLookup';
import { fetchTeamData } from './TeamLookup';
import { PREVIOUS_YEARS  } from './global_constants';
import { CURRENT_YEAR } from './DateHelper';
import FullRoster from './FullRoster';
import TeamSummary from './TeamSummary';
import TeamScores from './TeamScores';
import { fetchScoresData } from './ScoresLookup';
import TeamAnalytics from './TeamAnalytics';
import useIsMobile from './useIsMobile';
import InfoPageWrapper from './InfoPageWrapper';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function TeamPage() {
  const { id } = useParams();
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
  // Tab state
  const tabOptions = ['Overview', 'Scores', 'Analytics'];
  const urlTabRaw = searchParams.get('tab');
  const urlTab = urlTabRaw === 'Summary' || urlTabRaw === 'Roster' ? 'Overview' : urlTabRaw;
  const initialTab = tabOptions.includes(urlTab) ? urlTab : tabOptions[0];
  const [selectedTab, setSelectedTab] = useState(initialTab);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const teamAnalyticsRef = useRef();
  const teamScoresRef = useRef();
  const isMobile = useIsMobile();
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!seasonDropdownOpen) { return; }
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setSeasonDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [seasonDropdownOpen]);

  // Sync tab with query param
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    if (tabOptions.includes(selectedTab)) {
      newParams.set('tab', selectedTab);
    } else {
      newParams.set('tab', 'Overview');
    }
    if (selectedTab != 'Scores') {
      newParams.delete('week');
    }
    if (selectedTab != 'Analytics') {
      newParams.delete('start_week');
      newParams.delete('end_week');
    }
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line
  }, [selectedTab]);

  // If the query param changes (e.g., via browser nav), update the tab
  useEffect(() => {
    if (urlTab && tabOptions.includes(urlTab) && selectedTab !== urlTab) setSelectedTab(urlTab);
    // eslint-disable-next-line
  }, [urlTab]);

  // Sync season with query param
  useEffect(() => {
    if (selectedTab !== 'Analytics' && selectedTab !== 'Scores') {
      if (season === CURRENT_YEAR) {
        searchParams.delete('year');
        setSearchParams(searchParams, { replace: true });
      } else if (allYears.includes(season)) {
        searchParams.set('year', season);
        setSearchParams(searchParams, { replace: true });
      }
    }
    // eslint-disable-next-line
  }, [season]);

  // If the query param changes (e.g., via browser nav), update the dropdown
  useEffect(() => {
    if (urlYear && allYears.includes(urlYear) && season !== urlYear) setSeason(urlYear);
    if (!urlYear && season !== CURRENT_YEAR) setSeason(CURRENT_YEAR);
    // eslint-disable-next-line
  }, [urlYear]);

  // Fetch player data and playerIdMap on mount
  useEffect(() => {
    fetchPlayersData()
      .then(setPlayersData)
      .catch(() => setPlayersData(null));
    fetchPlayerIdMap()
      .then(setPlayerIdMap)
      .catch(() => setPlayerIdMap(null));
  }, []);

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
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        const foundRoster = teamData.rosters.find(r => String(r.roster_id) === String(id));
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

  if (!/^[1-9]\d*$/.test(id)) {
    return <Navigate to="/home/" replace />;
  }

  if (loading || !playersData || !playerIdMap || !rosters || !users) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!roster) return <div>No roster found for ID {id}</div>;

  // Get team name and avatars
  const ownerName = user && user.display_name ? user.display_name : 'Unknown';
  let teamName = null;
  if (user && user.metadata && user.metadata.team_name) {
    teamName = user.metadata.team_name;
  } else if (ownerName && ownerName !== 'Unknown') {
    teamName = `Team ${ownerName}`;
  } else {
    teamName = `Team ${id}`;
  }

  const userAvatarUrl = user.avatar_url;

  // Get player info for each player on the roster
  const playerList = (roster.players || []).map(pid => {
    const info = getPlayerInfo(pid, playersData, playerIdMap);
    return info ? info : { name: pid, position: '', espn_photo_url: null };
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
                const newParams = new URLSearchParams();
                if (searchParams.get('tab')) {
                  newParams.set('tab', searchParams.get('tab'));
                  newParams.delete('week');
                  newParams.delete('start_week');
                  newParams.delete('end_week');
                }
                setSearchParams(newParams, { replace: true });
                if (teamAnalyticsRef.current && typeof teamAnalyticsRef.current.resetWeek === 'function') {
                  teamAnalyticsRef.current.resetWeek(opt);
                }
                if (teamScoresRef.current && typeof teamScoresRef.current.resetWeek === 'function') {
                  teamScoresRef.current.resetWeek(opt);
                }
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <InfoPageWrapper
      leftHeader={leftHeader}
      title={teamName}
      subtitle={
        <div>
          <span>Owner: {ownerName}</span>
          {userAvatarUrl && (
            <img src={userAvatarUrl} alt="Owner Avatar" className="owner-avatar" />
          )}
        </div>
      }
    >
      {/* Tabs Bar */}
      <div className="team-tabs-bar">
        {tabOptions.map(tab => (
          <button
            key={tab}
            className={`team-tab${selectedTab === tab ? ' team-tab-active' : ''}`}
            onClick={() => setSelectedTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>
      {selectedTab === 'Overview' && <TeamSummary weeksParsedData={weeksParsedData} loading={scoresLoading} playersData={playersData} playerIdMap={playerIdMap} playerList={playerList} />}
      {selectedTab === 'Scores' && <TeamScores ref={teamScoresRef} weeksParsedData={weeksParsedData} playersData={playersData} playerIdMap={playerIdMap} />}
      {selectedTab === 'Analytics' && <TeamAnalytics ref={teamAnalyticsRef} weeksParsedData={weeksParsedData} teamName={teamName} rosters={rosters} users={users} />}
    </InfoPageWrapper>
  );
}

export default TeamPage; 