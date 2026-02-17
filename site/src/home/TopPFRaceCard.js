import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import useIsMobile from '../hooks/useIsMobile';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';

function computeTopPFRaceSeries(weeksParsedData, completedWeeks, playersData, playerIdMap, playerSeasonTotalsMap) {
  if (!Array.isArray(weeksParsedData)) {
    return { data: [], rosterIds: [], cumulativeTotals: {} };
  }

  const allRosterIds = Array.from(
    new Set(
      (weeksParsedData.flatMap((w) => (w || []).map((e) => Number(e.roster_id))) || []).filter(
        (rid) => Number.isFinite(rid),
      ),
    ),
  );

  const cumulative = {};
  allRosterIds.forEach((rid) => {
    cumulative[rid] = 0;
  });

  const chartData = [];

  const cappedWeeks = Math.max(0, Math.min(17, completedWeeks));

  for (let w = 1; w <= cappedWeeks; w += 1) {
    const weekEntries = weeksParsedData[w - 1] || [];
    const breakdown = getWeekScoreBreakdown(weeksParsedData, w) || {};

    weekEntries.forEach((entry) => {
      if (!entry || entry.roster_id == null) {
        return;
      }
      const rid = Number(entry.roster_id);
      if (!Number.isFinite(rid)) {
        return;
      }
      if (cumulative[rid] == null) {
        cumulative[rid] = 0;
      }

      const raw = breakdown[rid];
      let pts = 0;
      if (raw) {
        const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
        if (computed && typeof computed.starterTotal === 'number') {
          pts = computed.starterTotal;
        }
      } else if (typeof entry.points === 'number') {
        pts = entry.points;
      }
      cumulative[rid] += pts;
    });

    const point = { week: w };
    allRosterIds.forEach((rid) => {
      point[rid] = Math.round((cumulative[rid] || 0) * 10) / 10;
    });
    chartData.push(point);
  }

  return { data: chartData, rosterIds: allRosterIds, cumulativeTotals: cumulative };
}

function computeTopPFYAxisDomain(chartData) {
  if (!Array.isArray(chartData) || chartData.length === 0) {
    return [0, 20];
  }

  const values = [];
  chartData.forEach((point) => {
    ['t0', 't1'].forEach((key) => {
      const v = point && Object.prototype.hasOwnProperty.call(point, key) ? point[key] : null;
      if (typeof v === 'number' && Number.isFinite(v)) {
        values.push(v);
      }
    });
  });

  if (!values.length) {
    return [0, 20];
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const step = 50;

  let min = Math.floor(minVal / step) * step;
  let max = Math.ceil(maxVal / step) * step;

  if (min === max) {
    min -= step;
    max += step;
  }

  return [min, max];
}

function getTeamName(rosters, users, rosterId) {
  if (!Array.isArray(rosters) || !Array.isArray(users)) {
    return `Team ${rosterId}`;
  }

  const roster = rosters.find((r) => String(r.roster_id) === String(rosterId));
  if (!roster) {
    return `Team ${rosterId}`;
  }

  const user = users.find((u) => String(u.user_id) === String(roster.owner_id));
  if (user && user.metadata && user.metadata.team_name) {
    return user.metadata.team_name;
  }
  if (user && user.display_name) {
    return `Team ${user.display_name}`;
  }

  return `Team ${rosterId}`;
}

function getAvatar(rosters, users, rosterId) {
  if (!Array.isArray(rosters) || !Array.isArray(users)) {
    return null;
  }

  const roster = rosters.find((r) => String(r.roster_id) === String(rosterId));
  if (!roster) {
    return null;
  }

  const user = users.find((u) => String(u.user_id) === String(roster.owner_id));
  if (!user) {
    return null;
  }

  return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
}

function renderTopPFTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const weekLabel = typeof label === 'number' || typeof label === 'string' ? label : '';

  return (
    <div
      style={{
        backgroundColor: '#0f1430',
        border: '1px solid #3a4466',
        color: '#fff',
        padding: '6px 8px',
        borderRadius: '6px',
        fontSize: '0.75rem',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '4px' }}>
        {`Week ${weekLabel}`}
      </div>
      {payload.map((entry) => {
        const name = entry && entry.name ? entry.name : '';
        const val = entry && typeof entry.value === 'number' ? entry.value : null;
        return (
          <div
            key={entry.dataKey}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '0.5rem',
              marginBottom: '2px',
            }}
          >
            <span style={{ color: entry.color, fontWeight: 600, marginRight: '0.4rem' }}>
              {name}
            </span>
            <span>
              {val != null ? `${val.toFixed(1)} pts` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TopPFRaceCard({ currentWeekOverride = null }) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topTeams, setTopTeams] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [mobileTooltip, setMobileTooltip] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const season = CURRENT_YEAR;

        const baseCompleted = getCompletedWeeksCount(season);
        let completedWeeks = baseCompleted;

        if (currentWeekOverride != null) {
          const parsed = Number(currentWeekOverride);
          if (Number.isFinite(parsed) && parsed > 0) {
            completedWeeks = Math.min(parsed, baseCompleted);
          }
        }

        if (!Number.isFinite(completedWeeks) || completedWeeks < 1) {
          completedWeeks = 0;
        }

        const effectiveCompletedWeeks = Math.max(0, Math.min(17, completedWeeks));

        const [weeksData, teamData, players, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayersData(),
          fetchPlayerIdMap(),
        ]);

        if (cancelled) {
          return;
        }

        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);

        const { data, rosterIds, cumulativeTotals } = computeTopPFRaceSeries(
          weeksData,
          effectiveCompletedWeeks,
          players,
          idMap,
          playerSeasonTotalsMap,
        );

        if (!Array.isArray(rosterIds) || rosterIds.length === 0) {
          setTopTeams(null);
          setChartData(null);
          setLoading(false);
          return;
        }

        const totalsArray = rosterIds.map((rid) => ({
          rid,
          total: cumulativeTotals[rid] || 0,
        }));

        const sortedByPointsDesc = totalsArray
          .slice()
          .sort((a, b) => b.total - a.total || a.rid - b.rid);

        const placeByRosterId = {};
        sortedByPointsDesc.forEach((entry, index) => {
          placeByRosterId[entry.rid] = index + 1;
        });

        const topTeamsRaw = sortedByPointsDesc.slice(0, 2);

        if (!topTeamsRaw.length) {
          setTopTeams(null);
          setChartData(null);
          setLoading(false);
          return;
        }

        const mappedTop = topTeamsRaw.map((entry) => {
          const rosterId = entry.rid;
          return {
            rosterId,
            teamName: getTeamName(teamData.rosters, teamData.users, rosterId),
            place: placeByRosterId[rosterId] || null,
            totalPoints: Math.round((entry.total || 0) * 10) / 10,
            avatarUrl: getAvatar(teamData.rosters, teamData.users, rosterId),
          };
        });

        const orderedForDisplay = mappedTop
          .slice()
          .sort((a, b) => (a.place || 0) - (b.place || 0));

        const pfRosterIds = orderedForDisplay.map((team) => team.rosterId);

        let trimmedData = null;
        if (Array.isArray(data) && data.length > 0) {
          const lastThree = data.slice(-3);
          trimmedData = lastThree.map((point) => {
            const weekNum = point.week;
            const t0Key = pfRosterIds[0];
            const t1Key = pfRosterIds[1];
            return {
              week: weekNum,
              t0:
                t0Key != null && typeof point[t0Key] === 'number' && Number.isFinite(point[t0Key])
                  ? point[t0Key]
                  : null,
              t1:
                t1Key != null && typeof point[t1Key] === 'number' && Number.isFinite(point[t1Key])
                  ? point[t1Key]
                  : null,
            };
          });
        }

        setTopTeams(orderedForDisplay);
        setChartData(trimmedData);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load top PF race data right now.');
          setTopTeams(null);
          setChartData(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [currentWeekOverride]);

  const [yMin, yMax] = useMemo(() => {
    if (!chartData) {
      return [0, 0];
    }
    return computeTopPFYAxisDomain(chartData);
  }, [chartData]);

  let body = null;

  if (loading) {
    body = (
      <div className="tank-race-status">
        <LoadingState label="Loading PF race…" />
      </div>
    );
  } else if (error) {
    body = (
      <div className="tank-race-status tank-race-status--error">
        {error}
      </div>
    );
  } else if (!topTeams || topTeams.length === 0) {
    body = (
      <div className="tank-race-status">
        Not enough data yet to show the PF race.
      </div>
    );
  } else {
    body = (
      <div className="top-pf-body">
        <div className="top-pf-main">
          <div className="top-pf-left">
            <div className="top-pf-teams">
              {topTeams.map((team) => (
                <Link
                  to={`/team/${team.rosterId}`}
                  className="top-pf-team-row top-pf-team-row--clickable"
                  key={team.rosterId}
                >
                  <div className="top-pf-team-place">
                    #{team.place}
                  </div>
                  {team.avatarUrl && (
                    <img
                      className="top-pf-avatar"
                      src={team.avatarUrl}
                      alt={`${team.teamName} avatar`}
                    />
                  )}
                  <div className="top-pf-team-meta">
                    <div className="top-pf-team-name">
                      {team.teamName}
                    </div>
                    <div className="top-pf-team-points">
                      {team.totalPoints.toFixed(1)}
                      <span className="top-pf-team-points-units">
                        {' '}
                        pts
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
          {chartData && chartData.length >= 2 && (
            <div className="top-pf-right">
              <ResponsiveContainer width="100%" height={110}>
                <LineChart
                  data={chartData}
                  margin={{ top: 6, right: 6, left: 0, bottom: 2 }}
                  onClick={(e) => {
                    if (!isMobile || !e || !e.activePayload || !e.activePayload[0]) {
                      return;
                    }
                    const payload = e.activePayload[0].payload;
                    setMobileTooltip({
                      week: payload.week,
                      teams: [
                        {
                          name: topTeams[0]?.teamName || '',
                          value: payload.t0,
                          color: '#ecc94b',
                        },
                        {
                          name: topTeams[1]?.teamName || '',
                          value: payload.t1,
                          color: '#48bb78',
                        },
                      ].filter(t => t.value != null),
                    });
                  }}
                >
                  <CartesianGrid stroke="#2d3748" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: '#a0aec0', fontSize: 10 }}
                    axisLine={{ stroke: '#4a5568' }}
                    tickLine={{ stroke: '#4a5568' }}
                  />
                  <YAxis
                    tick={{ fill: '#a0aec0', fontSize: 10 }}
                    axisLine={{ stroke: '#4a5568' }}
                    tickLine={{ stroke: '#4a5568' }}
                    width={40}
                    domain={[yMin, yMax]}
                  />
                  <Tooltip
                    content={renderTopPFTooltip}
                    wrapperClassName={isMobile ? 'home-chart-tooltip-hidden' : ''}
                  />
                  {topTeams && topTeams[0] && (
                    <Line
                      type="monotone"
                      dataKey="t0"
                      name={topTeams[0].teamName}
                      stroke="#ecc94b"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  )}
                  {topTeams && topTeams[1] && (
                    <Line
                      type="monotone"
                      dataKey="t1"
                      name={topTeams[1].teamName}
                      stroke="#48bb78"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
              {isMobile && mobileTooltip && (
                <div className="home-chart-mobile-tooltip">
                  <button
                    className="home-chart-mobile-tooltip-close"
                    onClick={() => setMobileTooltip(null)}
                    aria-label="Close tooltip"
                  >
                    ×
                  </button>
                  <div className="home-chart-mobile-tooltip-content">
                    <div className="home-chart-mobile-tooltip-label">
                      Week {mobileTooltip.week}
                    </div>
                    {mobileTooltip.teams.map((team, idx) => (
                      <div key={idx} className="home-chart-mobile-tooltip-team">
                        <span className="home-chart-mobile-tooltip-team-name" style={{ color: team.color }}>
                          {team.name}
                        </span>
                        <span className="home-chart-mobile-tooltip-value">
                          {team.value.toFixed(1)} pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">
          📈 Top PF Race
        </h2>
        {body}
        {topTeams && topTeams.length === 2 && (
          <div className="active-playoffs-link-row">
            <Link
              className="active-playoffs-link"
              to={`/h2h?a=${topTeams[0].rosterId}&b=${topTeams[1].rosterId}`}
            >
              View Head To Head →
            </Link>
          </div>
        )}
      </div>
    </HomeCard>
  );
}

export default TopPFRaceCard;


