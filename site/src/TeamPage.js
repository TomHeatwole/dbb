import React, { useEffect, useState } from 'react';
import { useParams, Navigate, useSearchParams } from 'react-router-dom';
import { getPlayerInfo, fetchPlayersData, fetchPlayerIdMap } from './PlayerLookup';
import { fetchTeamData } from './TeamLookup';
import { LEAGUE_ID, PREVIOUS_YEARS, PREVIOUS_ROSTER_OVERRIDES } from './global_constants';
import { CURRENT_YEAR } from './DateHelper';
import FullRoster from './FullRoster';
import TeamSummary from './TeamSummary';
import TeamScores from './TeamScores';

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
  const tabOptions = ['Summary', 'Scores', 'Full Roster'];
  const urlTab = searchParams.get('tab');
  const initialTab = tabOptions.includes(urlTab) ? urlTab : tabOptions[0];
  const [selectedTab, setSelectedTab] = useState(initialTab);

  // Sync tab with query param
  useEffect(() => {
    if (selectedTab === tabOptions[0]) {
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
    } else if (tabOptions.includes(selectedTab)) {
      searchParams.set('tab', selectedTab);
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line
  }, [selectedTab]);

  // If the query param changes (e.g., via browser nav), update the tab
  useEffect(() => {
    if (urlTab && tabOptions.includes(urlTab) && selectedTab !== urlTab) setSelectedTab(urlTab);
    if (!urlTab && selectedTab !== tabOptions[0]) setSelectedTab(tabOptions[0]);
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
      <div
        className="season-dropdown season-dropdown-abs"
      >
        <div
          className="season-dropdown-selected season-dropdown-selected-style"
          onClick={() => setSeasonDropdownOpen(open => !open)}
        >
          {season}
          <span className="season-dropdown-arrow">{seasonDropdownOpen ? '▲' : '▼'}</span>
        </div>
        {seasonDropdownOpen && (
          <div
            className="season-dropdown-list season-dropdown-list-style"
          >
            {allYears.map(opt => (
              <div
                key={opt}
                className={`season-dropdown-option${opt === season ? ' season-dropdown-option-active' : ''}`}
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
      {selectedTab === 'Summary' && <TeamSummary />}
      {selectedTab === 'Scores' && <TeamScores />}
      {selectedTab === 'Full Roster' && <FullRoster playerList={playerList} />}
    </div>
  );
}

export default TeamPage; 