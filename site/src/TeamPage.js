import React, { useEffect, useState } from 'react';
import { useParams, Navigate, useSearchParams } from 'react-router-dom';
import { getPlayerInfo, fetchPlayersData, fetchPlayerIdMap } from './PlayerLookup';
import { fetchTeamData } from './TeamLookup';
import { LEAGUE_ID, PREVIOUS_YEARS, PREVIOUS_ROSTER_OVERRIDES } from './global_constants';
import { CURRENT_YEAR } from './DateHelper';
import FullRoster from './FullRoster';
import TeamSummary from './TeamSummary';
import TeamScores from './TeamScores';
import { fetchScoresData } from './ScoresLookup';
import TeamAnalytics from './TeamAnalytics';

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
  const tabOptions = ['Summary', 'Scores', 'Full Roster', 'Analytics'];
  const urlTab = searchParams.get('tab');
  const initialTab = tabOptions.includes(urlTab) ? urlTab : tabOptions[0];
  const [selectedTab, setSelectedTab] = useState(initialTab);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [scoresLoading, setScoresLoading] = useState(true);

  // Sync tab with query param
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    if (tabOptions.includes(selectedTab)) {
      newParams.set('tab', selectedTab);
    } else {
      newParams.set('tab', 'Summary');
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
    console.log(urlTab);
    if (urlTab && tabOptions.includes(urlTab) && selectedTab !== urlTab) setSelectedTab(urlTab);
    // if (!urlTab && selectedTab !== tabOptions[0]) setSelectedTab(tabOptions[0]);
    // eslint-disable-next-line
  }, [urlTab]);

  // Sync season with query param
  useEffect(() => {
    if (season === CURRENT_YEAR) {
      searchParams.delete('year');
      setSearchParams(searchParams, { replace: true });
    } else if (allYears.includes(season)) {
      searchParams.set('year', season);
      setSearchParams(searchParams, { replace: true });
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
        const leagueId = season === CURRENT_YEAR ? LEAGUE_ID : PREVIOUS_YEARS[season];
        const { rosters, users } = await fetchTeamData(leagueId);
        const foundRoster = rosters.find(r => String(r.roster_id) === String(id));
        setRoster(foundRoster);
        if (!foundRoster) {
          setUser(null);
          setLoading(false);
          return;
        }
        const foundUser = users.find(u => String(u.user_id) === String(foundRoster.owner_id)) ?? {};
        setUser(foundUser);
        // After finding foundRoster and foundUser, apply overrides if present
        const override = PREVIOUS_ROSTER_OVERRIDES[season] && PREVIOUS_ROSTER_OVERRIDES[season][id];
        if (override) {
          foundUser.display_name = override.owner;
          foundUser.metadata = { ...foundUser.metadata, team_name: override.name };
        }
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

  if (loading || !playersData || !playerIdMap) return <div>Loading...</div>;
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
  // Helper to get avatar URL from value (ID or URL)
  function getAvatarUrl(avatarVal) {
    if (!avatarVal) return null;
    if (typeof avatarVal === 'string' && avatarVal.startsWith('http')) return avatarVal;
    return `https://sleepercdn.com/avatars/${avatarVal}`;
  }
  const userAvatarUrl = getAvatarUrl(user && user.avatar);

  // Get player info for each player on the roster
  const playerList = (roster.players || []).map(pid => {
    const info = getPlayerInfo(pid, playersData, playerIdMap);
    return info ? info : { name: pid, position: '', espn_photo_url: null };
  });

  return (
    <div className="team-info-box team-info-rel">
      <div className="season-dropdown season-dropdown-abs">
        <div
          className="team-season-dropdown"
          onClick={() => setSeasonDropdownOpen(open => !open)}
        >
          {season}
          <span className="team-season-dropdown-arrow">{seasonDropdownOpen ? '▲' : '▼'}</span>
        </div>
        {seasonDropdownOpen && (
          <div className="team-season-dropdown-list">
            {allYears.map(opt => (
              <div
                key={opt}
                className={
                  'team-season-dropdown-option' +
                  (opt === season ? ' team-season-dropdown-option-active' : '')
                }
                onClick={() => { setSeason(opt); setSeasonDropdownOpen(false); }}
              >
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
      <h1 className="team-header">{teamName}</h1>
      <div className="owner-subtitle">
        <span>Owner: {ownerName}</span>
        {userAvatarUrl && (
          <img src={userAvatarUrl} alt="Owner Avatar" className="owner-avatar" />
        )}
      </div>
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
      {selectedTab === 'Summary' && <TeamSummary weeksParsedData={weeksParsedData} loading={scoresLoading} playersData={playersData} playerIdMap={playerIdMap} />}
      {selectedTab === 'Scores' && <TeamScores weeksParsedData={weeksParsedData} playersData={playersData} playerIdMap={playerIdMap} />}
      {selectedTab === 'Full Roster' && <FullRoster playerList={playerList} />}
      {selectedTab === 'Analytics' && <TeamAnalytics />}
    </div>
  );
}

export default TeamPage; 