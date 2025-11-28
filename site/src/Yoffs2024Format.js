import React, { useEffect, useState } from 'react';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getStandings } from './ScoresParser';
import useIsMobile from './useIsMobile';
import StandingsRowHeader from './StandingsRowHeader';

const PLAYOFF_START_WEEK = 14;
const PLAYOFF_END_WEEK = 17;

function Yoffs2024Format({ season }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [expanded, setExpanded] = useState({});
  const isMobile = useIsMobile();

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

        // Regular season weeks: everything before playoffs
        const regularSliceFull = weeksParsedData.slice(0, startIdx);
        const weeksRegular = regularSliceFull.filter(Boolean);

        // Playoff weeks: weeks 14–17
        const playoffSlice = weeksParsedData.slice(startIdx, endIdx + 1);
        const weeksPlayoffs = playoffSlice.filter(Boolean);

        if (!weeksPlayoffs.length || !weeksRegular.length) {
          if (!cancelled) {
            setRows([]);
            setRosters(teamData.rosters);
            setUsers(teamData.users);
            setLoading(false);
          }
          return;
        }

        // Regular season standings used to determine playoff seeds (top 4)
        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);
        const seedIds = top4Regular.map(r => Number(r.roster_id));
        const seedSet = new Set(seedIds);
        const seedPlaceById = {};
        top4Regular.forEach(r => {
          seedPlaceById[Number(r.roster_id)] = r.place;
        });

        const standingsPlayoffsAll = getStandings(weeksPlayoffs) || [];
        const standingsPlayoffs = standingsPlayoffsAll.filter(r =>
          seedSet.has(Number(r.roster_id))
        );

        // Regular season (weeks before playoffs) stats (total + PPG)
        const regularStatsByRoster = {};
        regularSliceFull.forEach((weekEntries) => {
          if (!Array.isArray(weekEntries)) {
            return;
          }
          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            const pts = typeof entry.points === 'number' ? entry.points : 0;
            if (!regularStatsByRoster[rid]) {
              regularStatsByRoster[rid] = {
                total: 0,
                weeksPlayed: 0,
              };
            }
            if (typeof pts === 'number' && isFinite(pts)) {
              regularStatsByRoster[rid].total += pts;
            }
            regularStatsByRoster[rid].weeksPlayed += 1;
          });
        });

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
                weekPoints: {},
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
              if (!s.weekPoints[realWeek]) {
                s.weekPoints[realWeek] = 0;
              }
              s.weekPoints[realWeek] += roundedPts;
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
            weekPoints: {},
            highPoints: null,
            highWeek: null,
            lowPoints: null,
            lowWeek: null,
          };
          const weeksPlayed = stats.weeksPlayed || 0;
          const total = typeof row.points_scored === 'number' ? row.points_scored : 0;
          const ppg = weeksPlayed > 0 ? Math.round((total / weeksPlayed) * 10) / 10 : null;
          const weekPoints = stats.weekPoints || {};
          const week15 = weekPoints[PLAYOFF_START_WEEK] != null ? weekPoints[PLAYOFF_START_WEEK] : null;
          const week16 = weekPoints[PLAYOFF_START_WEEK + 1] != null ? weekPoints[PLAYOFF_START_WEEK + 1] : null;
          const week17 = weekPoints[PLAYOFF_START_WEEK + 2] != null ? weekPoints[PLAYOFF_START_WEEK + 2] : null;
          const regularStats = regularStatsByRoster[rid] || { total: 0, weeksPlayed: 0 };
          const regularTotal = typeof regularStats.total === 'number' ? regularStats.total : 0;
          const regularPpg = regularStats.weeksPlayed > 0
            ? Math.round((regularTotal / regularStats.weeksPlayed) * 10) / 10
            : null;

          const displayPlace = seedPlaceById[rid] != null ? seedPlaceById[rid] : row.place;

          return {
            rosterId: rid,
            place: displayPlace,
            pointsScored: total,
            weeksPlayed,
            ppg,
            regularTotal,
            regularPpg,
            week15Score: week15,
            week16Score: week16,
            week17Score: week17,
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

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" aria-label="Loading" />
        <div className="loading-text">Loading playoff standings…</div>
      </div>
    );
  }

  if (error) {
    return <div>{error}</div>;
  }

  if (!rows.length) {
    return <div>No playoff data found for weeks 14–17.</div>;
  }

  const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);

  return (
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
                <div className="standings-row-expand-inner yoffs-standings-expand">
                  <div className="yoffs-section-row">
                    Total:{' '}
                    {typeof row.pointsScored === 'number' ? row.pointsScored.toFixed(1) : 'N/A'}
                  </div>
                  <div className="yoffs-section-row">
                    Avg:{' '}
                    {row.ppg != null ? row.ppg.toFixed(1) : 'N/A'}
                  </div>
                  <div className="yoffs-section-row">
                    Week 15:{' '}
                    {row.week15Score != null ? row.week15Score.toFixed(1) : 'N/A'}
                  </div>
                  <div className="yoffs-section-row">
                    Week 16:{' '}
                    {row.week16Score != null ? row.week16Score.toFixed(1) : 'N/A'}
                  </div>
                  <div className="yoffs-section-row">
                    Week 17:{' '}
                    {row.week17Score != null ? row.week17Score.toFixed(1) : 'N/A'}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default Yoffs2024Format;


