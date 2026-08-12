import React, { useMemo } from 'react';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import useIsMobile from '../hooks/useIsMobile';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea } from 'recharts';

const ME_LINE_COLOR = '#4ade80';

function computePlayoffRaceSeries(weeksParsedData, completedWeeks, rosterIds, playersData, playerIdMap, playerSeasonTotalsMap) {
  if (!Array.isArray(weeksParsedData)) {
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
  // Add Week 0 baseline: playoff bar is 0; all deltas and cumulative are 0.0
  const week0Point = { name: 'W0' };
  for (const rid of allRosterIds) {
    week0Point[rid] = 0;
    week0Point[`c_${rid}`] = 0;
  }
  chartData.push(week0Point);
  const cappedWeeks = Math.max(0, Math.min(14, completedWeeks));
  for (let w = 1; w <= cappedWeeks; w += 1) {
    const weekEntries = weeksParsedData[w - 1] || [];
    const breakdown = getWeekScoreBreakdown(weeksParsedData, w) || {};
    for (const entry of weekEntries) {
      if (!entry || entry.roster_id == null) { continue; }
      const rid = Number(entry.roster_id);
      if (cumulative[rid] == null) { cumulative[rid] = 0; }
      const raw = breakdown[rid];
      let pts = 0;
      if (raw) {
        const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
        pts = computed && typeof computed.starterTotal === 'number' ? computed.starterTotal : 0;
      } else if (typeof entry.points === 'number') {
        pts = entry.points;
      }
      cumulative[rid] += pts;
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
      point[`c_${rid}`] = Math.round((cumulative[rid] || 0) * 10) / 10;
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

export default function PlayoffRaceGraph({ weeksParsedData, completedWeeks, rosterIdToName, rosterIds, playersData, playerIdMap }) {
  const isMobile = useIsMobile();
  const myRosterId = useMyCurrentRosterId();
  function abbreviateTeamName(name) {
    if (!isMobile) { return name; }
    if (!name || typeof name !== 'string') { return name; }
    let n = name.replace(/^Team\s+/i, '').trim();
    if (n.includes(' ')) {
      const parts = n.split(/\s+/).filter(Boolean);
      const firstInitial = parts[0] ? parts[0][0].toUpperCase() : '';
      const last = parts[parts.length - 1] || '';
      const lastShort = last.length > 6 ? (last.slice(0, 6) + '…') : last;
      return `${firstInitial}.${lastShort}`;
    }
    return n.length > 8 ? (n.slice(0, 8) + '…') : n;
  }
  const rosterIdSet = useMemo(() => new Set(rosterIds || Object.keys(rosterIdToName || {}).map(Number)), [rosterIds, rosterIdToName]);
  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);
  const { data, rosterIds: seriesRosterIds } = useMemo(
    () => computePlayoffRaceSeries(weeksParsedData, completedWeeks, rosterIdSet, playersData, playerIdMap, playerSeasonTotalsMap),
    [weeksParsedData, completedWeeks, rosterIdSet, playersData, playerIdMap, playerSeasonTotalsMap]
  );

  // Draw "me" last so the solid green line sits on top of the dotted pack.
  const orderedRosterIds = useMemo(() => {
    if (myRosterId == null) return seriesRosterIds;
    const others = seriesRosterIds.filter((rid) => !isMyRoster(rid, myRosterId));
    const mine = seriesRosterIds.filter((rid) => isMyRoster(rid, myRosterId));
    return [...others, ...mine];
  }, [seriesRosterIds, myRosterId]);

  const [yMinRaw, yMaxRaw] = useMemo(() => computeRoundedYDomain(data, seriesRosterIds), [data, seriesRosterIds]);
  const yMin = Math.min(yMinRaw, 0);
  const yMax = Math.max(yMaxRaw, 0);

  const renderTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) { return null; }
    const weekNum = typeof label === 'string' ? label.replace('W', '') : label;
    const rows = payload
      .slice()
      .sort((a, b) => {
        const aMine = isMyRoster(a.dataKey, myRosterId);
        const bMine = isMyRoster(b.dataKey, myRosterId);
        if (aMine !== bMine) return aMine ? -1 : 1;
        const av = typeof a.value === 'number' ? a.value : -Infinity;
        const bv = typeof b.value === 'number' ? b.value : -Infinity;
        return bv - av;
      })
      .map((item) => {
        const ridKey = item.dataKey;
        const ridNum = Number(ridKey);
        const mine = isMyRoster(ridNum, myRosterId);
        const fullName = (rosterIdToName && rosterIdToName[ridNum]) ? rosterIdToName[ridNum] : (item.name || `Team ${ridKey}`);
        const teamName = abbreviateTeamName(fullName);
        const cumulativeVal = item.payload ? item.payload[`c_${ridKey}`] : undefined;
        const signedDelta = typeof item.value === 'number' ? (item.value >= 0 ? `+${Math.round(item.value)}` : `${Math.round(item.value)}`) : '';
        const valueText = `${typeof cumulativeVal === 'number' ? Math.round(cumulativeVal) : ''} (${signedDelta})`;
        return (
          <div
            key={ridKey}
            style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'space-between',
              width: '100%',
              alignItems: 'baseline',
              opacity: mine ? 1 : 0.85,
            }}
          >
            <span style={{
              color: mine ? ME_LINE_COLOR : item.color,
              fontWeight: mine ? 800 : 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingRight: '0.5rem',
              minWidth: 0,
              maxWidth: isMobile ? '65%' : 'unset',
            }}
            >
              {teamName}{mine ? ' · YOU' : ''}
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: mine ? 800 : 400 }}>{valueText}</span>
          </div>
        );
      });
    return (
      <div style={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff', borderRadius: '8px', padding: '8px 10px', minWidth: '200px', maxWidth: isMobile ? '90vw' : '70vw' }}>
        <div style={{ fontWeight: 800, textAlign: 'center', marginBottom: '6px' }}>{`Week ${weekNum}`}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {rows}
        </div>
      </div>
    );
  };

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
            <YAxis
              tick={{ fill: '#ccd' }}
              domain={[Math.min(yMin, 0), Math.max(yMax, 0)]}
            />
            {/* Add an extra mirrored tick label at 0 without changing main ticks */}
            <YAxis
              yAxisId="playoffLabel"
              tick={{ fill: '#ccd', fontWeight: 700 }}
              orientation="left"
              mirror={true}
              axisLine={false}
              tickLine={false}
              width={0}
              domain={[Math.min(yMin, 0), Math.max(yMax, 0)]}
              ticks={[0]}
              tickFormatter={() => 'Playoff Bar'}
            />
            {/* Background shading: above and below the playoff bar */}
            <ReferenceArea y1={0} y2={Math.max(yMax, 0)} fill="#ffd700" fillOpacity={0.14} />
            <ReferenceArea y1={Math.min(yMin, 0)} y2={0} fill="#4fb7ff" fillOpacity={0.1} />
            <Tooltip content={renderTooltip} />
            <Legend
              formatter={(value, entry) => {
                const rid = entry?.dataKey;
                const mine = isMyRoster(rid, myRosterId);
                return (
                  <span style={{
                    color: mine ? ME_LINE_COLOR : undefined,
                    fontWeight: mine ? 800 : 500,
                  }}
                  >
                    {value}{mine ? ' · YOU' : ''}
                  </span>
                );
              }}
            />
            {/* Solid baseline at 0.0 (no label) */}
            <ReferenceLine y={0} stroke="#ffffff" strokeWidth={1} ifOverflow="extendDomain" />
            {orderedRosterIds.map((rid) => {
              const mine = isMyRoster(rid, myRosterId);
              const baseName = rosterIdToName && rosterIdToName[rid] ? rosterIdToName[rid] : `Team ${rid}`;
              // Palette index from original series order so colors stay stable when "me" moves last
              const paletteIdx = Math.max(0, seriesRosterIds.indexOf(rid));
              return (
                <Line
                  key={rid}
                  type="monotone"
                  dataKey={rid}
                  name={baseName}
                  stroke={mine ? ME_LINE_COLOR : palette[paletteIdx % palette.length]}
                  dot={false}
                  strokeWidth={mine ? 3.5 : 2}
                  strokeDasharray={mine ? undefined : '6 6'}
                  strokeOpacity={mine ? 1 : 0.72}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
