import React from 'react';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';
import PositionBadge from '../PositionBadge';
import { AnalyticsLineChart, ANALYTICS_SERIES } from '../teams/AnalyticsCharts';

const pieColors = [
  '#a5b4fc', '#34d399', '#fbbf24', '#fb923c', '#38bdf8', '#f472b6', '#2dd4bf', '#f87171',
  '#c4b5fd', '#86efac', '#fcd34d', '#fdba74', '#7dd3fc', '#f9a8d4', '#5eead4', '#fca5a5',
];

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
  playerColorMap
}) {
  const isMobile = useIsMobile();
  const chartData = [];
  for (let weekIdx = 0; weekIdx < (endWeek - startWeek + 1); ++weekIdx) {
    const weekNum = startWeek + weekIdx;
    const week = Array.isArray(weeksParsedData) ? weeksParsedData[weekNum - 1] : null;
    if (!week) continue;
    const posScores = week.map(entry => (
      entry && Array.isArray(entry.starters_points) && entry.starters_points.length > pos && entry.starters_points[pos] != null
        ? entry.starters_points[pos]
        : 0
    ));
    const userEntry = week.find(entry => entry && entry.roster_id === rosterId);
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
    const userTeam = positionalBreakdown.find(t => t.roster_id === rosterId);
    if (userTeam && userTeam.positional_player_breakdown && userTeam.positional_player_breakdown[pos]) {
      breakdownData = Object.entries(userTeam.positional_player_breakdown[pos])
        .map(([playerId, data]) => {
          const info = getPlayerInfo(playerId, playersData, playerIdMap);
          return {
            playerId,
            count: data.starts,
            cumulative_score: data.cumulative_score,
            name: info ? info.name : playerId,
            position: info ? info.position : '',
            img: info ? info.espn_photo_url : null,
          };
        })
        .sort((a, b) => b.count - a.count);
    }
  }

  const posLabel = STARTER_POSITION_NAMES[pos] || `S${pos + 1}`;
  const teamLineName = teamName ? `${teamName}` : `Your ${posLabel}`;

  return (
    <>
      <div className="team-analytics-card team-analytics-pos-pie">
        <div className="team-analytics-card-head">
          <h3 className="team-analytics-card-title">{posLabel} starters</h3>
          <p className="team-analytics-card-sub">Who filled this slot over the selected weeks</p>
        </div>
        <div className="team-analytics-pie-inner">
          {breakdownData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={breakdownData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={isMobile ? 48 : 56}
                  outerRadius={isMobile ? 78 : 88}
                  paddingAngle={2}
                  stroke="rgba(10, 12, 28, 0.6)"
                  strokeWidth={2}
                >
                  {breakdownData.map((entry, idx) => {
                    const mapped = playerColorMap && playerColorMap[entry.playerId];
                    const fallback = pieColors[idx % pieColors.length];
                    return (
                      <Cell key={`cell-${entry.playerId}`} fill={mapped || fallback} />
                    );
                  })}
                </Pie>
                <Legend
                  layout="horizontal"
                  align="center"
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: '#94a3b8', maxHeight: 64, overflow: 'auto' }}
                  formatter={(value) => value}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      const totalStarts = endWeek - startWeek + 1;
                      const playerStarts = d.count;
                      const startPct = totalStarts > 0 ? Math.round((playerStarts / totalStarts) * 1000) / 10 : 0;
                      let avgScore = 0;
                      if (d.count > 0 && d.cumulative_score !== undefined) {
                        avgScore = Math.round((d.cumulative_score / d.count) * 10) / 10;
                      }
                      return (
                        <div className="team-analytics-tooltip">
                          <img src={getPlayerLogoUrl(d.img)} alt="" className="team-analytics-tooltip-avatar" />
                          <div className="team-analytics-tooltip-week">
                            {d.name} <PositionBadge position={d.position} />
                          </div>
                          <div className="team-analytics-tooltip-row">
                            <span className="team-analytics-tooltip-name">{posLabel} starts</span>
                            <span className="team-analytics-tooltip-pts">{playerStarts}</span>
                          </div>
                          <div className="team-analytics-tooltip-row">
                            <span className="team-analytics-tooltip-name">Share</span>
                            <span className="team-analytics-tooltip-pts">{startPct}%</span>
                          </div>
                          <div className="team-analytics-tooltip-row">
                            <span className="team-analytics-tooltip-name">Avg as {posLabel}</span>
                            <span className="team-analytics-tooltip-pts">{avgScore}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
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
