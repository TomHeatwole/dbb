import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getStandings } from './ScoresParser';
import { CURRENT_YEAR } from './DateHelper';
import { PREVIOUS_YEARS } from './global_constants';
import useIsMobile from './useIsMobile';
import StandingsRowHeader from './StandingsRowHeader';

const PLAYOFF_START_WEEK = 15;
const PLAYOFF_END_WEEK = 17;

function YoffsPage() {
  const [season, setSeason] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const yearDropdownRef = useRef(null);
  const isMobile = useIsMobile();

  const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

  useEffect(() => {
    trackPageLoad();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [weeksParsedData, teamData] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season)
        ]);

        if (!weeksParsedData || !Array.isArray(weeksParsedData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        const startIdx = PLAYOFF_START_WEEK - 1;
        const endIdx = PLAYOFF_END_WEEK - 1;
        const playoffSlice = weeksParsedData.slice(startIdx, endIdx + 1);
        const weeksPlayoffs = playoffSlice.filter(Boolean);

        if (!weeksPlayoffs.length) {
          if (!cancelled) {
            setRows([]);
            setRosters(teamData.rosters);
            setUsers(teamData.users);
            setLoading(false);
          }
          return;
        }

        const standingsPlayoffs = getStandings(weeksPlayoffs) || [];

        const statsByRoster = {};
        playoffSlice.forEach((weekEntries, idx) => {
          if (!Array.isArray(weekEntries)) {
            return;
          }
          const realWeek = PLAYOFF_START_WEEK + idx;
          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            const pts = typeof entry.points === 'number' ? entry.points : 0;
            if (!statsByRoster[rid]) {
              statsByRoster[rid] = {
                weeksPlayed: 0,
                highPoints: -Infinity,
                highWeek: null,
                lowPoints: Infinity,
                lowWeek: null,
              };
            }
            const s = statsByRoster[rid];
            s.weeksPlayed += 1;
            if (typeof pts === 'number' && isFinite(pts)) {
              const roundedPts = Math.round(pts * 10) / 10;
              if (roundedPts > s.highPoints) {
                s.highPoints = roundedPts;
                s.highWeek = realWeek;
              }
              if (roundedPts < s.lowPoints) {
                s.lowPoints = roundedPts;
                s.lowWeek = realWeek;
              }
            }
          });
        });

        const mergedRows = standingsPlayoffs.map((row) => {
          const rid = Number(row.roster_id);
          const stats = statsByRoster[rid] || {
            weeksPlayed: 0,
            highPoints: null,
            highWeek: null,
            lowPoints: null,
            lowWeek: null,
          };
          const weeksPlayed = stats.weeksPlayed || 0;
          const total = typeof row.points_scored === 'number' ? row.points_scored : 0;
          const ppg = weeksPlayed > 0 ? Math.round((total / weeksPlayed) * 10) / 10 : null;
          return {
            rosterId: rid,
            place: row.place,
            pointsScored: total,
            weeksPlayed,
            ppg,
            highPoints: isFinite(stats.highPoints) ? stats.highPoints : null,
            highWeek: stats.highWeek,
            lowPoints: isFinite(stats.lowPoints) ? stats.lowPoints : null,
            lowWeek: stats.lowWeek,
          };
        }).slice(0, 4);

        if (!cancelled) {
          setRows(mergedRows);
          setRosters(teamData.rosters);
          setUsers(teamData.users);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load playoff standings');
          setRows([]);
          setRosters(null);
          setUsers(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [season]);

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

  function getTeamName(rosterId) {
    if (!rosters || !users) {
      return `Team ${rosterId}`;
    }
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) {
      return `Team ${rosterId}`;
    }
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    if (user && user.metadata && user.metadata.team_name) {
      return user.metadata.team_name;
    }
    if (user && user.display_name) {
      return `Team ${user.display_name}`;
    }
    return `Team ${rosterId}`;
  }

  function getAvatar(rosterId) {
    if (!rosters || !users) {
      return null;
    }
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) {
      return null;
    }
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    if (!user) {
      return null;
    }
    return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
  }

  function toggleExpand(rosterId) {
    setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

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
                  setSeason(opt);
                  setYearDropdownOpen(false);
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="team-season-dropdown yoffs-mode-dropdown">
        <span>(bracket 2024 rules)</span>
        <span className="team-season-dropdown-arrow">▼</span>
      </div>
    </div>
  );

  let content = null;
  if (loading) {
    content = (
      <div className="loading-center">
        <div className="spinner" aria-label="Loading" />
        <div className="loading-text">Loading playoff standings…</div>
      </div>
    );
  } else if (error) {
    content = <div>{error}</div>;
  } else if (!rows.length) {
    content = <div>No playoff data found for weeks 14–17.</div>;
  } else {
    const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);
    content = (
      <div className={'standings-list' + (hasAnyExpanded ? ' standings-list--expanded' : '')}>
        {rows.map((row) => {
          const rosterId = row.rosterId;
          const isExpanded = !!expanded[rosterId];
          const teamName = getTeamName(rosterId);
          const avatarUrl = getAvatar(rosterId);
          const isTop4Highlight = row.place != null && row.place <= 4;

          const rightHeaderContent = isMobile ? (
            <span className="standings-total">
              {typeof row.pointsScored === 'number' ? `${Math.round(row.pointsScored)} pts` : ''}
            </span>
          ) : (
            <>
              <span className="standings-ppg">
                {row.ppg != null ? `${row.ppg.toFixed(1)} ppg` : ''}
              </span>
              <span className="standings-total">
                {typeof row.pointsScored === 'number' ? `${Math.round(row.pointsScored)} pts` : ''}
              </span>
            </>
          );

          return (
            <div key={rosterId} className={`standings-row ${isTop4Highlight ? 'standings-row--playoff' : ''}`}>
              <StandingsRowHeader
                isExpanded={isExpanded}
                onToggle={() => toggleExpand(rosterId)}
                rankLabel={`#${row.place}`}
                avatarUrl={avatarUrl}
                teamName={teamName}
                rightContent={rightHeaderContent}
              />
              {isExpanded && (
                <div className="standings-row-expand">
                  <div className="standings-row-expand-inner">
                    <div>Playoffs:</div>
                    <div>Games played: {row.weeksPlayed}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <InfoPageWrapper
      title="Yoffs"
      subtitle="Playoff standings (weeks 14–17 only)"
      leftHeader={leftHeader}
    >
      {content}
    </InfoPageWrapper>
  );
}

export default YoffsPage;

