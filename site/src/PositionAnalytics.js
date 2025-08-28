import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getPlayerInfo } from './PlayerLookup';
import { STARTER_POSITION_NAMES } from './global_constants';
import useIsMobile from './useIsMobile';

const pieColors = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088FE', '#00C49F', '#FFBB28', '#FF4444', '#A28FD0', '#FFB6B9', '#B5EAD7', '#C7CEEA', '#FFDAC1', '#E2F0CB', '#B5EAD7', '#FF9AA2'
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
  // Build line chart data for this position
  const chartData = [];
  for (let weekIdx = 0; weekIdx < (endWeek - startWeek + 1); ++weekIdx) {
    const weekNum = startWeek + weekIdx;
    const week = weeksParsedData[weekNum - 1];
    if (!week) continue;
    const posScores = week.map(entry => (entry && entry.starters_points && entry.starters_points[pos] != null) ? entry.starters_points[pos] : 0);
    const userEntry = week.find(entry => entry && entry.roster_id === rosterId);
    const userScore = userEntry && userEntry.starters_points && userEntry.starters_points[pos] != null ? userEntry.starters_points[pos] : 0;
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

  // Pie chart data for this position
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

  return (
    <>
      {/* Line Chart */}
      <div className="position-analytics-chart-container">
        <h3 className="position-analytics-chart-title">{posLabel} Weekly Scores</h3>
        <div className="position-analytics-chart-inner">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip contentStyle={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff' }} labelStyle={{ color: '#fff', fontWeight: 700 }} />
              <Legend />
              <Line type="monotone" dataKey="userScore" stroke="#8884d8" strokeWidth={2} activeDot={{ r: 8 }} name={teamName || `Your ${posLabel}`} />
              <Line type="monotone" dataKey="leagueCeiling" stroke="#00C49F" strokeWidth={2} name="League Ceiling" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueFloor" stroke="#FF8042" strokeWidth={2} name="League Floor" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueMedian" stroke="#0088FE" strokeWidth={2} name="League Median" dot={false} strokeDasharray="6 6" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* Pie Chart */}
      <div className="position-analytics-pie-container">
        <h3 className="position-analytics-pie-title">{posLabel} Breakdown</h3>
        <div className="position-analytics-pie-inner-flex">
          {breakdownData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={breakdownData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={isMobile ? 150 : 120}
                  labelLine={!isMobile}
                  label={isMobile ? false : (({ name, count }) => `${name} (${count})`)}
                >
                  {breakdownData.map((entry, idx) => {
                    const mapped = playerColorMap && playerColorMap[entry.playerId];
                    const fallback = pieColors[idx % pieColors.length];
                    const color = mapped || fallback;
                    return (
                      <Cell key={`cell-${entry.playerId}`} fill={color} />
                    );
                  })}
                </Pie>
                {isMobile ? <Legend /> : null}
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      const userTeam = positionalBreakdown.find(t => t.roster_id === rosterId);
                      const totalStarts = endWeek - startWeek + 1;
                      const playerStarts = d.count;
                      const startPct = totalStarts > 0 ? Math.round((playerStarts / totalStarts) * 1000) / 10 : 0;
                      let avgScore = 0;
                      if (d.count > 0 && d.cumulative_score !== undefined) {
                        avgScore = Math.round((d.cumulative_score / d.count) * 10) / 10;
                      }
                      return (
                        <div className="position-analytics-tooltip" style={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff', borderRadius: '8px', padding: '8px 10px' }}>
                          {d.img && <img src={d.img} alt={d.name} className="position-analytics-tooltip-img" />}
                          <div><b>{d.name} ({d.position})</b></div>
                          <div><b>{posLabel} starts:</b> {playerStarts}</div>
                          <div><b>{posLabel} start percentage:</b> {startPct}%</div>
                          <div><b>Avg score as {posLabel}:</b> {avgScore}</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="position-analytics-no-data">No {posLabel} data available.</div>
          )}
        </div>
      </div>
    </>
  );
} 