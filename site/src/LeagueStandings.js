import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { useSearchParams } from 'react-router-dom';
import { PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR } from './DateHelper';
import { getCurrentNFLWeek } from './DateHelper';
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

  function sumPointsForWeeks(weeksArr, rosterId) {
    if (!Array.isArray(weeksArr)) { return 0; }
    let total = 0;
    weeksArr.forEach(weekEntries => {
      if (!Array.isArray(weekEntries)) { return; }
      const entry = weekEntries.find(e => e && Number(e.roster_id) === Number(rosterId));
      if (entry && typeof entry.points === 'number') {
        total += entry.points;
      }
    });
    return total;
  }

  function computeTotals(rosterId, weeksArr) {
    const weeksCountLocal = Array.isArray(weeksArr) ? weeksArr.filter(Boolean).length : 0;
    const total = sumPointsForWeeks(weeksArr, rosterId);
    const ppg = weeksCountLocal > 0 ? Math.round((total / weeksCountLocal) * 10) / 10 : 0;
    return { total: Math.round(total), ppg, weeks: weeksCountLocal };
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
  const weeksFirst14 = Array.isArray(weeksParsedData) ? weeksParsedData.slice(0, 14).filter(Boolean) : [];
  const weeksCount14 = weeksFirst14.length;
  const weeks15to17 = Array.isArray(weeksParsedData) ? weeksParsedData.slice(14, 17).filter(Boolean) : [];

  const standingsAll = getStandings(weeksParsedData) || [];
  const standings14 = getStandings(weeksFirst14) || [];

  // Determine if we should apply playoff logic
  const isCurrentSeason = season === CURRENT_YEAR;
  const currentWeek = isCurrentSeason ? getCurrentNFLWeek() : 17;
  const usePlayoffLogic = !isCurrentSeason || currentWeek >= 15;

  // Determine playoff teams based on first 14 weeks (or current cumulative when playoff logic is off)
  const top4Source = usePlayoffLogic ? standings14 : standingsAll;
  const top4Ids = top4Source
    .slice()
    .sort((a, b) => a.place - b.place)
    .slice(0, 4)
    .map(r => r.roster_id);
  const top4Set = new Set(top4Ids);

  // Compute playoff points for weeks 15-17 and build playoff display rows
  const top4Display = usePlayoffLogic ? top4Ids
    .map(rid => {
      const playoffPoints = Math.round(sumPointsForWeeks(weeks15to17, rid));
      const seasonTotal = (standingsAll.find(s => s.roster_id === rid)?.points_scored) || 0;
      return { roster_id: rid, playoffPoints, seasonTotal };
    })
    .sort((a, b) => b.playoffPoints - a.playoffPoints)
    .map(r => ({ roster_id: r.roster_id, points_scored: r.playoffPoints, isPlayoff: true, weeksCount: weeks15to17.length })) : [];

  const othersSource = usePlayoffLogic ? standings14 : standingsAll;
  const othersWeeks = usePlayoffLogic ? weeksCount14 : weeksCount;
  const othersDisplay = othersSource
    .filter(r => !usePlayoffLogic || !top4Set.has(r.roster_id))
    .sort((a, b) => a.place - b.place)
    .slice(0, Math.max(0, 10 - top4Display.length))
    .map(r => ({
      roster_id: r.roster_id,
      points_scored: r.points_scored,
      isPlayoff: !usePlayoffLogic && top4Set.has(r.roster_id),
      weeksCount: othersWeeks
    }));

  const displayRows = [...top4Display, ...othersDisplay].slice(0, 10);

  function toggleExpand(rosterId) {
    setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

  return (
    <InfoPageWrapper title="Hwang Dynasty Standings" subtitle={null} leftHeader={leftHeader}>
      <div className="standings-list">
        {displayRows.map((row, idx) => {
          const rosterId = row.roster_id;
          const isExpanded = !!expanded[rosterId];
          const isPlayoff = row.isPlayoff;
          const teamName = getTeamName(rosterId);
          const avatarUrl = getAvatar(rosterId);

          // Display metrics
          const ppg = row.weeksCount > 0 ? Math.round((row.points_scored / row.weeksCount) * 10) / 10 : 0;

          // Expanded details for playoff teams
          const details14 = usePlayoffLogic && isPlayoff ? computeTotals(rosterId, weeksFirst14) : null;
          const details17 = usePlayoffLogic && isPlayoff ? computeTotals(rosterId, weeksParsedData) : null;

          return (
            <div key={rosterId} className={`standings-row ${isPlayoff ? 'standings-row--playoff' : ''}`}>
              <button className="standings-row-header" type="button" onClick={() => toggleExpand(rosterId)}>
                <span className={`standings-toggle-icon${isExpanded ? ' standings-toggle-icon--open' : ''}`}>{isExpanded ? '▾' : '▸'}</span>
                <span className="standings-rank">#{idx + 1}</span>
                {avatarUrl && <img className="standings-avatar" src={avatarUrl} alt={`${teamName} avatar`} />}
                <span className="standings-title">{teamName}</span>
                {usePlayoffLogic && isPlayoff ? (
                  <>
                    <span className="standings-ppg standings-ppg--playoff-mobile">Playoff: {Math.round(row.points_scored)} pts</span>
                    <span className="standings-total standings-total--playoff-desktop">Playoff: {Math.round(row.points_scored)} pts</span>
                  </>
                ) : (
                  <>
                    <span className="standings-ppg">{ppg} ppg</span>
                    <span className={`standings-total${usePlayoffLogic ? ' standings-metric' : ''}`}>
                      {Math.round(row.points_scored)} pts
                      {usePlayoffLogic && (
                        <span className="standings-tooltip">Non-playoff teams use only weeks 1–14 for PPG and totals.</span>
                      )}
                    </span>
                  </>
                )}
              </button>
              {isExpanded && (
                <div className="standings-row-expand">
                  {usePlayoffLogic && isPlayoff ? (
                    <div className="standings-row-expand-inner">
                      <div><strong>14-week:</strong> {details14?.ppg} ppg, {details14?.total} pts</div>
                      <div><strong>17-week:</strong> {details17?.ppg} ppg, {details17?.total} pts</div>
                    </div>
                  ) : (
                    <div className="standings-row-expand-inner">Details coming soon…</div>
                  )}
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