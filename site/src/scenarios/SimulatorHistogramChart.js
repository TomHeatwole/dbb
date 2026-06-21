import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

function HistogramTooltip({ active, payload, label, valueLabel = 'runs' }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const count = row?.count ?? payload[0]?.value ?? 0;
  const pct = row?.pct;

  return (
    <div className="simulator-hist-tooltip">
      <div className="simulator-hist-tooltip-label">{label || row?.label}</div>
      <div className="simulator-hist-tooltip-val">
        {count.toLocaleString()} {valueLabel}
        {pct != null ? ` (${pct.toFixed(1)}%)` : ''}
      </div>
    </div>
  );
}

/**
 * Simple vertical bar chart for simulator histograms.
 */
function SimulatorHistogramChart({
  data,
  height = 200,
  barColor = '#7c9cff',
  activeBarColor = '#a0b8ff',
  highlightPredicate,
  valueLabel = 'runs',
  emptyLabel = 'No data',
}) {
  const chartData = useMemo(() => (data || []).filter((d) => d.count > 0), [data]);

  if (chartData.length === 0) {
    return <div className="simulator-hist-empty">{emptyLabel}</div>;
  }

  return (
    <div className="simulator-hist-chart">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,160,0.12)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgba(170,175,220,0.65)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(120,120,160,0.15)' }}
            tickLine={false}
            interval={0}
            angle={chartData.length > 8 ? -35 : 0}
            textAnchor={chartData.length > 8 ? 'end' : 'middle'}
            height={chartData.length > 8 ? 48 : 24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'rgba(170,175,220,0.55)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            content={<HistogramTooltip valueLabel={valueLabel} />}
            cursor={{ fill: 'rgba(124,156,255,0.08)' }}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {chartData.map((entry, idx) => (
              <Cell
                key={`${entry.label}-${idx}`}
                fill={highlightPredicate?.(entry) ? activeBarColor : barColor}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SimulatorHistogramChart;
