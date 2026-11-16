import React, { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';
import { AnalyticsLineChart, ANALYTICS_SERIES } from '../teams/AnalyticsCharts';

const pieColors = [
  '#a5b4fc', '#34d399', '#fbbf24', '#fb923c', '#38bdf8', '#f472b6', '#2dd4bf', '#f87171',
  '#c4b5fd', '#86efac', '#fcd34d', '#fdba74', '#7dd3fc', '#f9a8d4', '#5eead4', '#fca5a5',
];

function sliceFill(entry, idx, playerColorMap) {
  const mapped = playerColorMap && playerColorMap[entry.playerId];
  return mapped || pieColors[idx % pieColors.length];
}

export default function PositionAnalytics({
  pos,
  positionalBreakdown,
  weeksParsedData,
  startWeek,
  endWeek,
  rosterId,
  teamName,
  playersData,
  playerIdMap,
  playerColorMap,
}) {
  const isMobile = useIsMobile();
  const [hoverId, setHoverId] = useState(null);

  const chartData = [];
  for (let weekIdx = 0; weekIdx < (endWeek - startWeek + 1); ++weekIdx) {
    const weekNum = startWeek + weekIdx;
    const week = Array.isArray(weeksParsedData) ? weeksParsedData[weekNum - 1] : null;
    if (!week) continue;
    const posScores = week.map((entry) => (
      entry && Array.isArray(entry.starters_points) && entry.starters_points.length > pos && entry.starters_points[pos] != null
        ? entry.starters_points[pos]
        : 0
    ));
    const userEntry = week.find((entry) => entry && entry.roster_id === rosterId);
    const userScore = (userEntry && Array.isArray(userEntry.starters_points) && userEntry.starters_points.length > pos && userEntry.starters_points[pos] != null)
      ? userEntry.starters_points[pos]
      : 0;
    const sorted = [...posScores].sort((a, b) => b - a);
    const leagueCeiling = sorted.length ? sorted[0] : 0;
    const leagueFloor = sorted.length ? sorted[sorted.length - 1] : 0;
    let leagueMedian = 0;
    if (sorted.length >= 6) {
      leagueMedian = (sorted[4] + sorted[5]) / 2;
    } else if (sorted.length > 0) {
      const mid = Math.floor(sorted.length / 2);
      leagueMedian = sorted[mid];
    }
    chartData.push({
      name: `Week ${weekNum}`,
      userScore: Math.round(userScore * 10) / 10,
      leagueCeiling: Math.round(leagueCeiling * 10) / 10,
      leagueFloor: Math.round(leagueFloor * 10) / 10,
      leagueMedian: Math.round(leagueMedian * 10) / 10,
    });
  }

  let breakdownData = [];
  if (positionalBreakdown && positionalBreakdown.length && playersData && playerIdMap) {
    const userTeam = positionalBreakdown.find((t) => t.roster_id === rosterId);
    if (userTeam && userTeam.positional_player_breakdown && userTeam.positional_player_breakdown[pos]) {
      breakdownData = Object.entries(userTeam.positional_player_breakdown[pos])
        .map(([playerId, data]) => {
          const info = getPlayerInfo(playerId, playersData, playerIdMap);
          return {
            playerId,
            count: data.starts,
            cumulative_score: data.cumulative_score,
            name: info ? info.name : playerId,
            img: info ? info.espn_photo_url : null,
          };
        })
        .sort((a, b) => b.count - a.count);
    }
  }

  const posLabel = STARTER_POSITION_NAMES[pos] || `S${pos + 1}`;
  const teamLineName = teamName ? `${teamName}` : `Your ${posLabel}`;
  const weekSpan = Math.max(1, endWeek - startWeek + 1);

  const activeIndex = hoverId != null
    ? breakdownData.findIndex((d) => d.playerId === hoverId)
    : undefined;

  const clearHover = () => setHoverId(null);

  return (
    <>
      <div className="team-analytics-card team-analytics-pos-pie">
        <div className="team-analytics-card-head">
          <h3 className="team-analytics-card-title">{posLabel} starters</h3>
          <p className="team-analytics-card-sub">Who filled this slot over the selected weeks</p>
        </div>
        <div className="team-analytics-pie-inner">
          {breakdownData.length > 0 ? (
            <div
              className="team-analytics-slot-share"
              onMouseLeave={clearHover}
            >
              <div className="team-analytics-slot-share-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={breakdownData}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={isMobile ? 40 : 44}
                      outerRadius={isMobile ? 62 : 68}
                      paddingAngle={breakdownData.length > 1 ? 2 : 0}
                      stroke="rgba(10, 12, 28, 0.85)"
                      strokeWidth={2}
                      activeIndex={activeIndex >= 0 ? activeIndex : undefined}
                      isAnimationActive={false}
                    >
                      {breakdownData.map((entry, idx) => {
                        const fill = sliceFill(entry, idx, playerColorMap);
                        const dimmed = hoverId != null && hoverId !== entry.playerId;
                        return (
                          <Cell
                            key={`cell-${entry.playerId}`}
                            fill={fill}
                            fillOpacity={dimmed ? 0.35 : 1}
                            stroke={hoverId === entry.playerId ? fill : undefined}
                            strokeWidth={hoverId === entry.playerId ? 3 : 2}
                            onMouseEnter={() => setHoverId(entry.playerId)}
                          />
                        );
                      })}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="team-analytics-slot-share-roster" aria-label={`${posLabel} starter breakdown`}>
                {breakdownData.map((entry, idx) => {
                  const fill = sliceFill(entry, idx, playerColorMap);
                  const sharePct = weekSpan > 0 ? Math.round((entry.count / weekSpan) * 1000) / 10 : 0;
                  const avgScore = entry.count > 0
                    ? Math.round((entry.cumulative_score / entry.count) * 10) / 10
                    : 0;
                  const isActive = hoverId === entry.playerId;
                  return (
                    <li
                      key={entry.playerId}
                      className={`team-analytics-slot-share-row${isActive ? ' team-analytics-slot-share-row--active' : ''}`}
                      onMouseEnter={() => setHoverId(entry.playerId)}
                    >
                      <img
                        className="team-analytics-slot-share-avatar"
                        src={getPlayerLogoUrl(entry.img)}
                        alt=""
                        style={{ boxShadow: `0 0 0 1px ${fill}` }}
                      />
                      <div className="team-analytics-slot-share-main">
                        <div className="team-analytics-slot-share-name">{entry.name}</div>
                        <div className="team-analytics-slot-share-track" aria-hidden="true">
                          <div
                            className="team-analytics-slot-share-fill"
                            style={{ width: `${Math.min(100, sharePct)}%`, background: fill }}
                          />
                        </div>
                      </div>
                      <div className="team-analytics-slot-share-meta">
                        <span className="team-analytics-slot-share-pct">{sharePct}%</span>
                        <span className="team-analytics-slot-share-avg">{avgScore} avg</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="team-analytics-empty">No {posLabel} data for this range.</div>
          )}
        </div>
      </div>
      <div className="team-analytics-card team-analytics-pos-line">
        <div className="team-analytics-card-head">
          <h3 className="team-analytics-card-title">{posLabel} weekly scores</h3>
          <p className="team-analytics-card-sub">Starter points at this slot vs the league each week</p>
        </div>
        <AnalyticsLineChart
          data={chartData}
          lines={[
            { dataKey: 'userScore', stroke: ANALYTICS_SERIES.team, name: teamLineName, activeDot: { r: 5 } },
            { dataKey: 'leagueCeiling', stroke: ANALYTICS_SERIES.ceiling, name: 'Ceiling', strokeDasharray: '5 5' },
            { dataKey: 'leagueMedian', stroke: ANALYTICS_SERIES.median, name: 'Median', strokeDasharray: '5 5' },
            { dataKey: 'leagueFloor', stroke: ANALYTICS_SERIES.floor, name: 'Floor', strokeDasharray: '5 5' },
          ]}
        />
      </div>
    </>
  );
}