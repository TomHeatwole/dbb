import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export const ANALYTICS_TICK = { fill: '#94a3b8', fontSize: 11 };
export const ANALYTICS_SERIES = {
  team: '#a5b4fc',
  ceiling: '#34d399',
  floor: '#fb923c',
  median: '#38bdf8',
  playoff: '#fbbf24',
};

export function formatWeekTick(value) {
  return String(value).replace(/^Week\s+/i, 'W');
}

export function AnalyticsTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="team-analytics-tooltip">
      <div className="team-analytics-tooltip-week">{label}</div>
      {payload.map((entry) => {
        const raw = entry.value;
        const display = formatter ? formatter(raw, entry.dataKey, entry) : raw;
        return (
          <div key={entry.dataKey} className="team-analytics-tooltip-row">
            <span className="team-analytics-tooltip-swatch" style={{ background: entry.color }} />
            <span className="team-analytics-tooltip-name">{entry.name}</span>
            <span className="team-analytics-tooltip-pts">{display}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyticsLineChart({
  data,
  lines,
  yTickFormatter,
  tooltipFormatter,
}) {
  return (
    <div className="team-analytics-chart-plot">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(148, 180, 255, 0.08)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={ANALYTICS_TICK}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatWeekTick}
            padding={{ left: 4, right: 8 }}
          />
          <YAxis
            tick={ANALYTICS_TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={yTickFormatter}
          />
          <Tooltip
            cursor={{ stroke: 'rgba(165, 180, 252, 0.35)', strokeWidth: 1 }}
            content={<AnalyticsTooltip formatter={tooltipFormatter} />}
            wrapperStyle={{ outline: 'none' }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 6, color: '#94a3b8' }}
          />
          {lines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth || 2}
              name={line.name}
              dot={line.dot === undefined ? false : line.dot}
              activeDot={line.activeDot || { r: 4, strokeWidth: 1, stroke: '#e2e8f0' }}
              strokeDasharray={line.strokeDasharray}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
