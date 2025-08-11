import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { useSearchParams } from 'react-router-dom';
import { PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR } from './DateHelper';
import { getStandings } from './ScoresParser';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function LeagueStandings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const initialSeason = urlYear && allYears.includes(urlYear) ? urlYear : CURRENT_YEAR;
  const [season, setSeason] = useState(initialSeason);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

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
    // eslint-disable-next-line
  }, [season]);

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
        setError('Failed to load standings');
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

  if (loading) {
    return (
      <InfoPageWrapper title="Hwang DynastyStandings" subtitle={null} leftHeader={leftHeader}>
        <div>Loading standings…</div>
      </InfoPageWrapper>
    );
  }
  if (error || !weeksParsedData || !rosters || !users) {
    return (
      <InfoPageWrapper title="Hwang Dynasty Standings" subtitle={null} leftHeader={leftHeader}>
        <div>Error loading standings.</div>
      </InfoPageWrapper>
    );
  }

  const weeksCount = Array.isArray(weeksParsedData) ? weeksParsedData.filter(Boolean).length : 0;
  const standingsArr = getStandings(weeksParsedData) || [];
  const sortedStandings = [...standingsArr].sort((a, b) => a.place - b.place).slice(0, 10);

  function toggleExpand(rosterId) {
    setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

  return (
    <InfoPageWrapper title="Hwang Dynasty Standings" subtitle={null} leftHeader={leftHeader}>
      <div className="standings-list">
        {sortedStandings.map((row, idx) => {
          const rosterId = row.roster_id;
          const isExpanded = !!expanded[rosterId];
          const isPlayoff = idx < 4;
          const teamName = getTeamName(rosterId);
          const avatarUrl = getAvatar(rosterId);
          const ppg = weeksCount > 0 ? Math.round((row.points_scored / weeksCount) * 10) / 10 : 0;
          return (
            <div key={rosterId} className={`standings-row ${isPlayoff ? 'standings-row--playoff' : ''}`}>
              <button className="standings-row-header" type="button" onClick={() => toggleExpand(rosterId)}>
                <span className={`standings-toggle-icon${isExpanded ? ' standings-toggle-icon--open' : ''}`}>{isExpanded ? '▾' : '▸'}</span>
                <span className="standings-rank">#{row.place}</span>
                {avatarUrl && <img className="standings-avatar" src={avatarUrl} alt={`${teamName} avatar`} />}
                <span className="standings-title">{teamName}</span>
                <span className="standings-ppg">{ppg} ppg</span>
                <span className="standings-total">{Math.round(row.points_scored)} pts</span>
              </button>
              {isExpanded && (
                <div className="standings-row-expand">
                  {/* More team details can go here in future iterations */}
                  <div className="standings-row-expand-inner">Details coming soon…</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </InfoPageWrapper>
  );
}

export default LeagueStandings; 