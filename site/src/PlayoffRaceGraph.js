import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

function computePlayoffRaceSeries(weeksParsedData, completedWeeks, rosterIds) {
  if (!Array.isArray(weeksParsedData) || completedWeeks <= 0) {
    return { data: [], rosterIds: Array.from(rosterIds || []) };
  }

  const allRosterIds = rosterIds && rosterIds.size > 0
    ? Array.from(rosterIds)
    : Array.from(new Set((weeksParsedData.flatMap(w => (w || []).map(e => Number(e.roster_id))) || [])));

  const cumulative = {};
  for (const rid of allRosterIds) {
    cumulative[rid] = 0;
  }

  const chartData = [];
  const cappedWeeks = Math.max(0, Math.min(14, completedWeeks));
  for (let w = 1; w <= cappedWeeks; w += 1) {
    const weekEntries = weeksParsedData[w - 1] || [];
    for (const entry of weekEntries) {
      if (entry && entry.roster_id != null && typeof entry.points === 'number') {
        const rid = Number(entry.roster_id);
        if (cumulative[rid] == null) { cumulative[rid] = 0; }
        cumulative[rid] += entry.points;
      }
    }

    // Determine playoff bar for this week based on cumulative totals
    const cumArr = allRosterIds.map(rid => ({ rid, pts: Math.round((cumulative[rid] || 0) * 10) / 10 }));
    cumArr.sort((a, b) => b.pts - a.pts);
    let playoffBar = 0;
    if (cumArr.length >= 5) {
      playoffBar = (cumArr[3].pts + cumArr[4].pts) / 2;
    } else if (cumArr.length >= 4) {
      playoffBar = cumArr[3].pts;
    } else if (cumArr.length > 0) {
      // Fallback: use median
      const mid = Math.floor(cumArr.length / 2);
      playoffBar = cumArr[mid].pts;
    }

    const point = { name: `W${w}` };
    for (const rid of allRosterIds) {
      const delta = (cumulative[rid] || 0) - playoffBar;
      point[rid] = Math.round(delta * 10) / 10;
    }
    chartData.push(point);
  }

  return { data: chartData, rosterIds: allRosterIds };
}

function computeRoundedYDomain(data, seriesRosterIds) {
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(seriesRosterIds) || seriesRosterIds.length === 0) {
    return [-10, 10];
  }
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const point of data) {
    for (const rid of seriesRosterIds) {
      const v = point[rid];
      if (typeof v === 'number' && isFinite(v)) {
        if (v < minVal) { minVal = v; }
        if (v > maxVal) { maxVal = v; }
      }
    }
  }
  if (!isFinite(minVal) || !isFinite(maxVal)) {
    return [-10, 10];
  }
  let floor = Math.floor(minVal / 25) * 25;
  let ceil = Math.ceil(maxVal / 25) * 25;
  // Ensure strictly below/above when exactly on a multiple of 25
  if (minVal === floor) { floor -= 25; }
  if (maxVal === ceil) { ceil += 25; }
  return [floor, ceil];
}

export default function PlayoffRaceGraph({ weeksParsedData, completedWeeks, rosterIdToName, rosterIds }) {
  const rosterIdSet = useMemo(() => new Set(rosterIds || Object.keys(rosterIdToName || {}).map(Number)), [rosterIds, rosterIdToName]);
  const { data, rosterIds: seriesRosterIds } = useMemo(
    () => computePlayoffRaceSeries(weeksParsedData, completedWeeks, rosterIdSet),
    [weeksParsedData, completedWeeks, rosterIdSet]
  );

  const [yMin, yMax] = useMemo(() => computeRoundedYDomain(data, seriesRosterIds), [data, seriesRosterIds]);

  if (!data || data.length === 0) {
    return null;
  }

  // Define a simple color palette
  const palette = [
    '#4fb7ff', '#ff7f50', '#9acd32', '#ff69b4', '#ffd700',
    '#7fffd4', '#dda0dd', '#87ceeb', '#ff8c00', '#adff2f',
    '#20b2aa', '#db7093', '#1e90ff', '#98fb98', '#ba55d3'
  ];

  return (
    <div className="playoff-race-graph">
      <h2 className="info-title">
        Playoff Race
        <span className="info-icon" aria-label="Info" title="">
          ℹ️
          <span className="info-icon-tooltip">
            This chart uses the average of 4th and 5th place cumulative points each week as the playoff bar (0.0). Each line shows a team's cumulative score relative to that bar.
          </span>
        </span>
      </h2>
      <div className="playoff-race-chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 12, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334" />
            <XAxis dataKey="name" tick={{ fill: '#ccd' }} />
            <YAxis tick={{ fill: '#ccd' }} domain={[yMin, yMax]} />
            <Tooltip
              formatter={(value) => `${value} pts`}
              labelFormatter={(l) => `Week ${l?.replace('W','')}`}
              itemSorter={(item) => {
                const v = item && typeof item.value === 'number' ? item.value : -Infinity;
                return -v; // negative for descending order
              }}
              contentStyle={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff' }}
              labelStyle={{ color: '#fff' }}
            />
            <Legend />
            {/* Solid baseline at 0.0 labeled Playoff Bar */}
            <ReferenceLine y={0} stroke="#ffffff" strokeWidth={1} ifOverflow="extendDomain" label={{ value: 'Playoff Bar', position: 'insideTopLeft', fill: '#fff' }} />
            {seriesRosterIds.map((rid, idx) => (
              <Line
                key={rid}
                type="monotone"
                dataKey={rid}
                name={rosterIdToName && rosterIdToName[rid] ? rosterIdToName[rid] : `Team ${rid}`}
                stroke={palette[idx % palette.length]}
                dot={false}
                strokeWidth={2}
                strokeDasharray="6 6"
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
} 