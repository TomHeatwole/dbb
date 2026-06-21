import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatHistogramAxisCount,
  histogramYAxisWidth,
} from './simulatorProgress';
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

function HistogramTooltip({ active, payload, valueLabel = 'runs', showRange = false }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const count = row?.count ?? payload[0]?.value ?? 0;
  const pct = row?.pct;

  const label = showRange && row?.lo != null && row?.hi != null
    ? `${Math.round(row.lo)}–${Math.round(row.hi)} pts`
    : (row?.label || '');

  return (
    <div className="simulator-hist-tooltip">
      <div className="simulator-hist-tooltip-label">{label}</div>
      <div className="simulator-hist-tooltip-val">
        {count.toLocaleString()} {valueLabel}
        {pct != null ? ` (${pct.toFixed(1)}%)` : ''}
      </div>
    </div>
  );
}

function niceYMax(max) {
  if (max <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function buildXTicks(minLo, maxHi, count = 6) {
  if (maxHi <= minLo) return [minLo];
  const span = maxHi - minLo;
  const step = span / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(minLo + i * step));
}

/**
 * SVG histogram — bars sized/placed by score range so they always touch.
 */
function ContinuousScoreHistogram({
  data,
  height = 180,
  barColor = '#7c9cff',
  valueLabel = 'runs',
  emptyLabel = 'No data',
}) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;

    const update = () => setWidth(el.clientWidth);
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxCount = useMemo(
    () => Math.max(...(data || []).map((d) => d.count), 0),
    [data],
  );

  const yMax = niceYMax(maxCount);
  const yAxisLeft = histogramYAxisWidth(yMax);
  const padding = { top: 8, right: 8, bottom: 28, left: yAxisLeft };
  const plotW = Math.max(0, width - padding.left - padding.right);
  const plotH = height - padding.top - padding.bottom;

  const minLo = data?.[0]?.lo ?? 0;
  const maxHi = data?.[data.length - 1]?.hi ?? minLo + 1;
  const span = maxHi - minLo || 1;
  const xTicks = useMemo(() => buildXTicks(minLo, maxHi), [minLo, maxHi]);
  const yTicks = [0, Math.round(yMax / 2), yMax];

  if (!data?.length || maxCount === 0) {
    return <div className="simulator-hist-empty">{emptyLabel}</div>;
  }

  const barAt = (clientX) => {
    const el = wrapRef.current;
    if (!el || plotW <= 0) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - padding.left;
    const score = minLo + (x / plotW) * span;
    return data.find((d) => score >= d.lo && score < d.hi) || data[data.length - 1];
  };

  return (
    <div
      ref={wrapRef}
      className="simulator-hist-chart simulator-hist-chart--continuous"
      onMouseMove={(e) => setHover(barAt(e.clientX))}
      onMouseLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} className="simulator-hist-svg">
          {yTicks.map((tick) => {
            const y = padding.top + plotH - (tick / yMax) * plotH;
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={padding.left}
                  x2={padding.left + plotW}
                  y1={y}
                  y2={y}
                  stroke="rgba(120,120,160,0.12)"
                  strokeDasharray="3 3"
                />
                <text
                  x={padding.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  fill="rgba(170,175,220,0.55)"
                  fontSize={10}
                >
                  {formatHistogramAxisCount(tick)}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const x = padding.left + ((d.lo - minLo) / span) * plotW;
            const w = ((d.hi - d.lo) / span) * plotW;
            const h = (d.count / yMax) * plotH;
            const isHover = hover && hover.lo === d.lo && hover.hi === d.hi;
            return (
              <rect
                key={`${d.lo}-${i}`}
                x={x}
                y={padding.top + plotH - h}
                width={w}
                height={h}
                fill={isHover ? `${barColor}dd` : barColor}
                stroke="none"
              />
            );
          })}

          {xTicks.map((tick) => {
            const x = padding.left + ((tick - minLo) / span) * plotW;
            return (
              <text
                key={`x-${tick}`}
                x={x}
                y={height - 8}
                textAnchor="middle"
                fill="rgba(170,175,220,0.65)"
                fontSize={10}
              >
                {tick}
              </text>
            );
          })}

          <line
            x1={padding.left}
            x2={padding.left + plotW}
            y1={padding.top + plotH}
            y2={padding.top + plotH}
            stroke="rgba(120,120,160,0.15)"
          />
        </svg>
      )}

      {hover && (
        <div
          className="simulator-hist-hover-tooltip"
          style={{
            left: padding.left + ((hover.mid - minLo) / span) * plotW,
          }}
        >
          <div className="simulator-hist-tooltip-label">
            {Math.round(hover.lo)}–{Math.round(hover.hi)} pts
          </div>
          <div className="simulator-hist-tooltip-val">
            {hover.count.toLocaleString()} {valueLabel}
            {hover.pct != null ? ` (${hover.pct.toFixed(1)}%)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @param {'categorical'|'continuous'} variant
 */
function SimulatorHistogramChart({
  data,
  height = 200,
  barColor = '#7c9cff',
  activeBarColor = '#a0b8ff',
  highlightPredicate,
  valueLabel = 'runs',
  emptyLabel = 'No data',
  variant = 'categorical',
}) {
  const chartData = useMemo(
    () => (variant === 'continuous' ? data : (data || []).filter((d) => d.count > 0)),
    [data, variant],
  );

  if (variant === 'continuous') {
    return (
      <ContinuousScoreHistogram
        data={chartData}
        height={height}
        barColor={barColor}
        valueLabel={valueLabel}
        emptyLabel={emptyLabel}
      />
    );
  }

  if (chartData.length === 0) {
    return <div className="simulator-hist-empty">{emptyLabel}</div>;
  }

  const maxCount = Math.max(...chartData.map((d) => d.count), 0);
  const yAxisW = histogramYAxisWidth(niceYMax(maxCount));

  return (
    <div className="simulator-hist-chart">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
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
            width={yAxisW}
            tickFormatter={formatHistogramAxisCount}
          />
          <Tooltip
            content={<HistogramTooltip valueLabel={valueLabel} />}
            cursor={{ fill: 'rgba(124,156,255,0.08)' }}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
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
