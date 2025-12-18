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
  ReferenceLine,
} from 'recharts';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import useIsMobile from '../hooks/useIsMobile';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';

function computeBubbleSeries(weeksParsedData, completedWeeks, playersData, playerIdMap, playerSeasonTotalsMap) {
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

  const week0Point = { name: 'W0' };
  allRosterIds.forEach((rid) => {
    week0Point[rid] = 0;
    week0Point[`c_${rid}`] = 0;
  });
  chartData.push(week0Point);

  const cappedWeeks = Math.max(0, Math.min(14, completedWeeks));

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

    const cumArr = allRosterIds.map((rid) => ({
      rid,
      pts: Math.round((cumulative[rid] || 0) * 10) / 10,
    }));

    cumArr.sort((a, b) => b.pts - a.pts);

    let playoffBar = 0;
    if (cumArr.length >= 5) {
      playoffBar = (cumArr[3].pts + cumArr[4].pts) / 2;
    } else if (cumArr.length >= 4) {
      playoffBar = cumArr[3].pts;
    } else if (cumArr.length > 0) {
      const mid = Math.floor(cumArr.length / 2);
      playoffBar = cumArr[mid].pts;
    }

    const point = { name: `W${w}` };
    allRosterIds.forEach((rid) => {
      const teamTotal = cumulative[rid] || 0;
      const delta = teamTotal - playoffBar;
      point[rid] = Math.round(delta * 10) / 10;
      point[`c_${rid}`] = Math.round(teamTotal * 10) / 10;
    });
    chartData.push(point);
  }

  return { data: chartData, rosterIds: allRosterIds, cumulativeTotals: cumulative };
}

function computeBubbleYAxisDomain(chartData) {
  if (!Array.isArray(chartData) || chartData.length === 0) {
    return [0, 20];
  }

  const values = [];
  chartData.forEach((point) => {
    ['t0', 't1', 't2'].forEach((key) => {
      const v = point && Object.prototype.hasOwnProperty.call(point, key) ? point[key] : null;
      if (typeof v === 'number' && Number.isFinite(v)) {
        values.push(v);
      }
    });
  });

  if (values.length === 0) {
    return [0, 20];
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const step = 20;

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

function renderBubbleTooltip({ active, payload, label }) {
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
      <div
        style={{
          marginTop: '4px',
          fontStyle: 'italic',
          opacity: 0.8,
        }}
      >
        (cumulative score relative to playoff bar)
      </div>
    </div>
  );
}

function BubbleCard({ currentWeekOverride = null }) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bubbleTeams, setBubbleTeams] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [mobileTooltip, setMobileTooltip] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const season = CURRENT_YEAR;

        let currentWeek = getCurrentNFLWeek(season);
        if (currentWeekOverride != null) {
          const parsed = Number(currentWeekOverride);
          if (Number.isFinite(parsed) && parsed > 0) {
            currentWeek = parsed;
          }
        }

        if (!Number.isFinite(currentWeek) || currentWeek < 1) {
          currentWeek = 1;
        }

        const effectiveWeek = Math.max(1, Math.min(14, currentWeek));

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

        const { data, rosterIds, cumulativeTotals } = computeBubbleSeries(
          weeksData,
          effectiveWeek,
          players,
          idMap,
          playerSeasonTotalsMap,
        );

        if (!Array.isArray(rosterIds) || rosterIds.length === 0) {
          setBubbleTeams(null);
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

        // Get teams ranked 4th, 5th, and 6th
        const bubbleTeamsRaw = sortedByPointsDesc.slice(3, 6);

        if (!bubbleTeamsRaw.length) {
          setBubbleTeams(null);
          setChartData(null);
          setLoading(false);
          return;
        }

        const mappedBubble = bubbleTeamsRaw.map((entry) => {
          const rosterId = entry.rid;
          return {
            rosterId,
            teamName: getTeamName(teamData.rosters, teamData.users, rosterId),
            place: placeByRosterId[rosterId] || null,
            totalPoints: Math.round((entry.total || 0) * 10) / 10,
            avatarUrl: getAvatar(teamData.rosters, teamData.users, rosterId),
          };
        });

        // Keep them in descending order (4th, 5th, 6th)
        const orderedForDisplay = mappedBubble;

        const bubbleRosterIds = orderedForDisplay.map((team) => team.rosterId);

        let trimmedData = null;
        if (Array.isArray(data) && data.length > 0) {
          const nonBaseline = data.filter(
            (point) => point && typeof point.name === 'string' && point.name !== 'W0',
          );
          const lastThree = nonBaseline.slice(-3);
          trimmedData = lastThree.map((point) => {
            const label = typeof point.name === 'string' ? point.name.replace(/^W/i, '') : point.name;
            const weekNum = Number(label);
            const t0Key = bubbleRosterIds[0];
            const t1Key = bubbleRosterIds[1];
            const t2Key = bubbleRosterIds[2];
            return {
              week: Number.isFinite(weekNum) ? weekNum : label,
              t0:
                t0Key != null && typeof point[t0Key] === 'number' && Number.isFinite(point[t0Key])
                  ? point[t0Key]
                  : null,
              t1:
                t1Key != null && typeof point[t1Key] === 'number' && Number.isFinite(point[t1Key])
                  ? point[t1Key]
                  : null,
              t2:
                t2Key != null && typeof point[t2Key] === 'number' && Number.isFinite(point[t2Key])
                  ? point[t2Key]
                  : null,
            };
          });
        }

        setBubbleTeams(orderedForDisplay);
        setChartData(trimmedData);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load bubble team data right now.');
          setBubbleTeams(null);
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
    return computeBubbleYAxisDomain(chartData);
  }, [chartData]);

  let body = null;

  if (loading) {
    body = (
      <div className="tank-race-status">
        <LoadingState label="Loading bubble teams…" />
      </div>
    );
  } else if (error) {
    body = (
      <div className="tank-race-status tank-race-status--error">
        {error}
      </div>
    );
  } else if (!bubbleTeams || bubbleTeams.length === 0) {
    body = (
      <div className="tank-race-status">
        Not enough data yet to show bubble teams.
      </div>
    );
  } else {
    body = (
      <div className="tank-race-body">
        <div className="tank-race-main">
          <div className="tank-race-left">
            <div className="tank-race-teams">
              {bubbleTeams.map((team) => (
                <Link
                  to={`/team/${team.rosterId}`}
                  className="tank-race-team-row tank-race-team-row--clickable bubble-team-row"
                  key={team.rosterId}
                >
                  <div className="tank-race-team-place">
                    #{team.place}
                  </div>
                  {team.avatarUrl && (
                    <img
                      className="tank-race-avatar"
                      src={team.avatarUrl}
                      alt={`${team.teamName} avatar`}
                    />
                  )}
                  <div className="tank-race-team-meta">
                    <div className="tank-race-team-name">
                      {team.teamName}
                    </div>
                    <div className="tank-race-team-points">
                      {team.totalPoints.toFixed(1)}
                      <span className="tank-race-team-points-units">
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
            <div className="tank-race-right">
              <ResponsiveContainer width="100%" height={150}>
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
                          name: bubbleTeams[0]?.teamName || '',
                          value: payload.t0,
                          color: '#4fd1c5',
                        },
                        {
                          name: bubbleTeams[1]?.teamName || '',
                          value: payload.t1,
                          color: '#f687b3',
                        },
                        {
                          name: bubbleTeams[2]?.teamName || '',
                          value: payload.t2,
                          color: '#b794f4',
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
                    width={32}
                    domain={[yMin, yMax]}
                  />
                  <Tooltip
                    content={renderBubbleTooltip}
                    wrapperClassName={isMobile ? 'home-chart-tooltip-hidden' : ''}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="#718096"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    label={{ 
                      value: 'Playoff Bar', 
                      position: 'top', 
                      fill: '#718096', 
                      fontSize: 10,
                      offset: 5,
                      style: { 
                        backgroundColor: '#1a202c',
                        padding: '2px 4px',
                        borderRadius: '3px'
                      }
                    }}
                  />
                  {bubbleTeams && bubbleTeams[0] && (
                    <Line
                      type="monotone"
                      dataKey="t0"
                      name={bubbleTeams[0].teamName}
                      stroke="#4fd1c5"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  )}
                  {bubbleTeams && bubbleTeams[1] && (
                    <Line
                      type="monotone"
                      dataKey="t1"
                      name={bubbleTeams[1].teamName}
                      stroke="#f687b3"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  )}
                  {bubbleTeams && bubbleTeams[2] && (
                    <Line
                      type="monotone"
                      dataKey="t2"
                      name={bubbleTeams[2].teamName}
                      stroke="#b794f4"
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
                    <div className="home-chart-mobile-tooltip-note">
                      (cumulative score relative to playoff bar)
                    </div>
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
          🫧 On the Bubble
        </h2>
        {body}
      </div>
    </HomeCard>
  );
}

export default BubbleCard;

