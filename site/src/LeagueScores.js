import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { useSearchParams, Link } from 'react-router-dom';
import { PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR } from './DateHelper';
import { getDefaultDisplayWeek } from './DateHelper';
import WeekSelector from './WeekSelector';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getWeekScoreBreakdown } from './ScoresParser';

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
      fetchTeamData(season)
    ])
      .then(([weeksData, teamData]) => {
        setWeeksParsedData(weeksData);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
      })
      .catch(() => {
        setWeeksParsedData(null);
        setRosters(null);
        setUsers(null);
        setError('Failed to load scores');
      })
      .finally(() => setLoading(false));
  }, [season]);

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
              className={'team-season-dropdown-option' + (opt === season ? ' team-season-dropdown-option-active' : '')}
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
        <div className="standings-list standings-list--scores">
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
                      <div className="standings-row-expand-inner standings-stats-grid">
                        <div className="stat-label">Starters:</div>
                        <div className="stat-v1">{startersTotal} pts</div>
                        <div className="stat-v2"></div>
                        <div className="stat-v3"></div>

                        <div className="stat-label">Bench:</div>
                        <div className="stat-v1">{benchTotal} pts</div>
                        <div className="stat-v2"></div>
                        <div className="stat-v3"></div>

                        <div className="standings-team-link">
                          <Link to={`/team/${rosterId}${searchParams && searchParams.toString() ? `?${searchParams.toString()}` : ''}`}>See Team Overview</Link>
                        </div>
                      </div>
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