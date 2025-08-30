import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { useSearchParams, Link } from 'react-router-dom';
import { PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR, getDefaultDisplayWeek, getCurrentNFLWeek } from './DateHelper';
import WeekSelector from './WeekSelector';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getWeekScoreBreakdown } from './ScoresParser';
import TeamScoresTables from './TeamScoresTables';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from './PlayerLookup';
import useIsMobile from './useIsMobile';
import MobileTeamScoreSummary from './MobileTeamScoreSummary';
import LeagueScoresTeamBreakdown from './LeagueScoresTeamBreakdown';
import { fetchNflScoreboard } from './GamesLookup';
import { mapPlayersToGames, getEventLabelForTeam, getGameDisplayForTeam } from './GamesParser';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function LeagueScores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const initialSeason = urlYear && allYears.includes(urlYear) ? urlYear : CURRENT_YEAR;
  const [season, setSeason] = useState(initialSeason);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const urlWeek = parseInt(searchParams.get('week'), 10);
  const initialWeek = !isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= 17 ? urlWeek : getDefaultDisplayWeek(season);
  const [week, setWeek] = useState(initialWeek);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [benchOpen, setBenchOpen] = useState({});
  const isMobile = useIsMobile();
  const [playerGameLabels, setPlayerGameLabels] = useState({});

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

  useEffect(() => {
    if (urlYear && allYears.includes(urlYear) && season !== urlYear) {
      setSeason(urlYear);
      setDropdownOpen(false);
    }
    if (!urlYear && season !== CURRENT_YEAR) {
      setSeason(CURRENT_YEAR);
      setDropdownOpen(false);
    }
    // eslint-disable-next-line
  }, [urlYear]);

  useEffect(() => {
    if (season === CURRENT_YEAR) {
      searchParams.delete('year');
      setSearchParams(searchParams, { replace: true });
    } else if (allYears.includes(season)) {
      searchParams.set('year', season);
      setSearchParams(searchParams, { replace: true });
    }
    // Reset week to default for the selected season
    const newWeek = getDefaultDisplayWeek(season);
    setWeek(newWeek);
    // eslint-disable-next-line
  }, [season]);

  // sync week param
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('week', week);
    newParams.set('tab', 'Scores');
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line
  }, [week]);

  useEffect(() => {
    if (!isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= 17 && week !== urlWeek)  {
      setWeek(urlWeek);
    }
    // eslint-disable-next-line
  }, [urlWeek]);

  // Load league scores/teams for season
  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchScoresData(season),
      fetchTeamData(season),
      fetchPlayersData(),
      fetchPlayerIdMap()
    ])
      .then(([weeksData, teamData, players, idMap]) => {
        setWeeksParsedData(weeksData);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        setPlayersData(players);
        setPlayerIdMap(idMap);
      })
      .catch(() => {
        setWeeksParsedData(null);
        setRosters(null);
        setUsers(null);
        setPlayersData(null);
        setPlayerIdMap(null);
        setError('Failed to load scores');
      })
      .finally(() => setLoading(false));
  }, [season]);

  // Compute player->game labels for the selected week (web tables)
  useEffect(() => {
    if (!playersData || !playerIdMap || !weeksParsedData) { return; }
    const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[week - 1] : null;
    if (!Array.isArray(weekArr)) { return; }
    const playerIdSet = new Set();
    for (const entry of weekArr) {
      if (entry && Array.isArray(entry.players)) {
        for (const pid of entry.players) { playerIdSet.add(pid); }
      }
    }
    const playerIds = Array.from(playerIdSet);
    if (playerIds.length === 0) { setPlayerGameLabels({}); return; }

    const seasonYear = Number(season);
    let cancelled = false;
    fetchNflScoreboard(seasonYear, week)
      .then(async (json) => {
        if (cancelled) { return; }
        const mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, json);
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) { setPlayerGameLabels(labels); }
      })
      .catch(() => { if (!cancelled) { setPlayerGameLabels({}); } });
    return () => { cancelled = true; };
  }, [season, week, playersData, playerIdMap, weeksParsedData]);

  function getTeamName(rosterId) {
    if (!rosters || !users) return `Team ${rosterId}`;
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) return `Team ${rosterId}`;
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    if (user && user.metadata && user.metadata.team_name) return user.metadata.team_name;
    if (user && user.display_name) return `Team ${user.display_name}`;
    return `Team ${rosterId}`;
  }

  function getAvatar(rosterId) {
    if (!rosters || !users) return null;
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) return null;
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    return user && user.avatar_url ? user.avatar_url : null;
  }

  function toggleExpand(rosterId) {
    setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }
  function toggleBench(rosterId) {
    setBenchOpen(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

  const leftHeader = (
    <div
      ref={dropdownRef}
      className="team-season-dropdown"
      onClick={() => setDropdownOpen(open => !open)}
    >
      {season}
      <span className="team-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
      {dropdownOpen && (
        <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
          {allYears.map(opt => (
            <div
              key={opt}
              className={'team-scores-week-dropdown-option' + (opt === season ? ' team-scores-week-dropdown-option-active' : '')}
              onClick={() => {
                setSeason(opt);
                setDropdownOpen(false);
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
    <InfoPageWrapper title="Hwang Dynasty Scores" subtitle={null} leftHeader={leftHeader}>
      <div className="team-scores-container">
        <WeekSelector week={week} onChange={setWeek} />
      </div>
      {loading ? (
        <div>Loading scores…</div>
      ) : error || !weeksParsedData || !rosters || !users ? (
        <div>Error loading scores.</div>
      ) : (
        <div className={`standings-list standings-list--scores${hasAnyExpanded ? ' standings-list--expanded' : ''}`}>
          {(Array.isArray(weeksParsedData) && weeksParsedData[week - 1] ? weeksParsedData[week - 1] : [])
            .filter(e => e && e.roster_id != null && typeof e.points === 'number')
            .slice()
            .sort((a, b) => b.points - a.points)
            .map((entry) => {
              const rosterId = entry.roster_id;
              const teamName = getTeamName(rosterId);
              const avatarUrl = getAvatar(rosterId);
              const isExpanded = !!expanded[rosterId];
              const weekBreakdown = getWeekScoreBreakdown(weeksParsedData, week)[rosterId];
              const startersTotal = weekBreakdown ? weekBreakdown.starterTotal : 0;
              const benchTotal = weekBreakdown ? weekBreakdown.benchTotal : 0;
              const isActiveWeek = (season === CURRENT_YEAR) && (week === getCurrentNFLWeek());
              return (
                <div key={rosterId} className="standings-row">
                  <button className="standings-row-header" type="button" onClick={() => toggleExpand(rosterId)}>
                    <span className={`standings-toggle-icon${isExpanded ? ' standings-toggle-icon--open' : ''}`}>{isExpanded ? '▾' : '▸'}</span>
                    {/* No rank number for live scores */}
                    <span className="standings-rank" style={{ visibility: 'hidden' }}>#</span>
                    {avatarUrl && <img className="standings-avatar" src={avatarUrl} alt={`${teamName} avatar`} />}
                    <span className="standings-title">{teamName}</span>
                    <span className="standings-total">{Math.round(entry.points * 10) / 10} pts</span>
                  </button>
                  {isExpanded && (
                    <div className="standings-row-expand">
                      {isMobile ? (
                        <MobileTeamScoreSummary
                          weekBreakdown={weekBreakdown}
                          week={week}
                          rosterId={rosterId}
                          searchParams={searchParams}
                        />
                      ) : (
                        <LeagueScoresTeamBreakdown
                          weekBreakdown={weekBreakdown}
                          week={week}
                          rosterId={rosterId}
                          benchOpen={!!benchOpen[rosterId]}
                          onToggleBench={() => toggleBench(rosterId)}
                          benchTotal={benchTotal}
                          playersData={playersData}
                          playerIdMap={playerIdMap}
                          searchParams={searchParams}
                          playerGameLabels={playerGameLabels}
                          isActiveWeek={isActiveWeek}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </InfoPageWrapper>
  );
}

export default LeagueScores; 