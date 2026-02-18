import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import WeekSelector from '../scores/WeekSelector';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';

// ── Custom tooltip ────────────────────────────────────────────────────────────

function WeeklyTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  const original = payload.find((p) => p.dataKey === 'original');
  const scenario = payload.find((p) => p.dataKey === 'scenario');
  const origVal  = original ? Number(original.value) : 0;
  const scenVal  = scenario ? Number(scenario.value) : 0;
  const delta    = scenVal - origVal;

  return (
    <div className="scenario-chart-tooltip">
      <div className="scenario-chart-tooltip-week">{label}</div>
      <div className="scenario-chart-tooltip-row">
        <span className="scenario-chart-tooltip-dot scenario-chart-tooltip-dot--original" />
        <span className="scenario-chart-tooltip-label">Original</span>
        <span className="scenario-chart-tooltip-val">{origVal.toFixed(1)}</span>
      </div>
      <div className="scenario-chart-tooltip-row">
        <span className="scenario-chart-tooltip-dot scenario-chart-tooltip-dot--scenario" />
        <span className="scenario-chart-tooltip-label">Scenario</span>
        <span className="scenario-chart-tooltip-val">{scenVal.toFixed(1)}</span>
      </div>
      {delta !== 0 && (
        <div className={`scenario-chart-tooltip-delta ${delta > 0 ? 'scenario-chart-tooltip-delta--pos' : 'scenario-chart-tooltip-delta--neg'}`}>
          {delta > 0 ? '+' : ''}{delta.toFixed(1)}
        </div>
      )}
    </div>
  );
}

// ── Inline delta badge ────────────────────────────────────────────────────────

function PtsDelta({ delta, tooltip }) {
  const [tipPos, setTipPos] = useState(null);

  if (delta == null || Math.abs(delta) < 0.05) return null;
  const isPos = delta > 0;

  const badge = (
    <span className={`scenario-week-delta ${isPos ? 'scenario-week-delta--pos' : 'scenario-week-delta--neg'}`}>
      {isPos ? '+' : ''}{delta.toFixed(1)}
    </span>
  );

  if (!tooltip) return badge;

  return (
    <>
      <span
        className="scenario-delta-tooltip-wrap"
        onMouseEnter={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e)  => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTipPos(null)}
      >
        {badge}
      </span>
      {tipPos && (
        <span
          className="scenario-delta-tooltip-fixed"
          style={{ left: tipPos.x + 12, top: tipPos.y - 36 }}
        >
          {tooltip}
        </span>
      )}
    </>
  );
}

// ── Per-week starters / bench table ──────────────────────────────────────────

function ScenarioWeekTable({ scenarioWeek, originalWeek, playersData, playerIdMap }) {
  const [benchExpanded, setBenchExpanded] = useState(false);
  const startersSectionRef = useRef(null);
  const [startersHeight, setStartersHeight] = useState(null);

  useEffect(() => {
    const el = startersSectionRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => { setStartersHeight(el.offsetHeight); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!scenarioWeek) return <div className="scenario-week-table-empty">No data for this week.</div>;

  const origStarterMap = {};
  (originalWeek?.starters || []).forEach((p, i) => { origStarterMap[i] = p.pts || 0; });

  // Bench is slot-agnostic (Bench1, Bench2…) — sort both by pts desc and compare by position
  const sortedOrigBench = (originalWeek?.bench || []).slice().sort((a, b) => (b.pts || 0) - (a.pts || 0));

  const scenTotal    = scenarioWeek.starterTotal || 0;
  const origTotal    = originalWeek?.starterTotal || 0;
  const totalDelta   = scenTotal - origTotal;

  const scenBenchTotal  = scenarioWeek.benchTotal || 0;
  const origBenchTotal  = originalWeek?.benchTotal || 0;
  const benchTotalDelta = scenBenchTotal - origBenchTotal;

  // ── Starters table: pos | player | pts | delta ──────────────────────────────
  const renderStarterRow = (p, i) => {
    const info    = getPlayerInfo(p.id, playersData, playerIdMap);
    const name    = info?.name || (p.id === '0' ? '' : p.id);
    const pos     = info?.position || '';
    const team    = info?.team || info?.team_abbr || '';
    const logo    = getPlayerLogoUrl(info?.espn_photo_url);
    const pts     = p.pts || 0;
    const delta   = pts - (origStarterMap[i] ?? 0);
    const posLabel = STARTER_POSITION_NAMES[i] || `S${i + 1}`;

    // Build tooltip: show who was in this slot originally (if it changed)
    const origPlayer = originalWeek?.starters?.[i];
    let deltaTooltip = null;
    if (delta !== 0) {
      if (!origPlayer || origPlayer.id === '0') {
        deltaTooltip = 'Slot was empty originally';
      } else if (origPlayer.id !== p.id) {
        const origInfo = getPlayerInfo(origPlayer.id, playersData, playerIdMap);
        const origName = origInfo?.name || origPlayer.id;
        deltaTooltip = `Was: ${origName}`;
      }
    }

    return (
      <tr key={`s-${p.id}-${i}`} className="scenario-week-row">
        <td className="scenario-week-pos">{posLabel}</td>
        <td className="scenario-week-player">
          <div className="scenario-week-player-inner">
            <img src={logo} alt="" className="scenario-week-avatar" />
            <span className="scenario-week-name">{name}</span>
            {pos  && <span className="scenario-week-meta">{pos}</span>}
            {team && <span className="scenario-week-meta scenario-week-team">{team}</span>}
          </div>
        </td>
        <td className="scenario-week-pts">{pts.toFixed(1)}</td>
        <td className="scenario-week-delta-col"><PtsDelta delta={delta} tooltip={deltaTooltip} /></td>
      </tr>
    );
  };

  // ── Bench grid item ──────────────────────────────────────────────────────────
  // slotIdx: position in sorted-desc bench list (Bench1, Bench2…)
  const renderBenchItem = (p, slotIdx) => {
    const info  = getPlayerInfo(p.id, playersData, playerIdMap);
    const name  = info?.name || (p.id === '0' ? '' : p.id);
    const pos   = info?.position || '';
    const logo  = getPlayerLogoUrl(info?.espn_photo_url);
    const pts   = p.pts || 0;

    // Compare this bench slot against the same slot in the original bench
    const origAtSlot = sortedOrigBench[slotIdx];
    const delta      = pts - (origAtSlot?.pts || 0);

    let deltaTooltip = null;
    if (origAtSlot && origAtSlot.id !== p.id) {
      const origInfo = getPlayerInfo(origAtSlot.id, playersData, playerIdMap);
      const origName = origInfo?.name || origAtSlot.id;
      deltaTooltip = `Was: ${origName}`;
    } else if (!origAtSlot) {
      deltaTooltip = 'New bench slot';
    }

    return (
      <div key={p.id} className="scenario-week-bench-item">
        <div className="scenario-week-bench-player">
          <img src={logo} alt="" className="scenario-week-avatar" />
          <span className="scenario-week-name">{name}</span>
          {pos && <span className="scenario-week-meta">{pos}</span>}
        </div>
        <span className="scenario-week-bench-pts">{pts.toFixed(1)}</span>
        <span className="scenario-week-bench-delta-col"><PtsDelta delta={delta} tooltip={deltaTooltip} /></span>
      </div>
    );
  };

  const sortedBench = (scenarioWeek.bench || []).slice().sort((a, b) => (b.pts || 0) - (a.pts || 0));

  return (
    <div className="scenario-week-table">
      {/* ── Starters ── */}
      <div className="scenario-week-section" ref={startersSectionRef}>
        <table className="scenario-week-tbl">
          <thead>
            {/* Totals row lives inside the table so column widths are guaranteed to align */}
            <tr className="scenario-week-totals-row">
              <td colSpan={2} className="scenario-week-totals-label">
                <span className="scenario-week-section-label">Starters</span>
              </td>
              <td className="scenario-week-pts scenario-week-totals-pts">{scenTotal.toFixed(1)}</td>
              <td className="scenario-week-delta-col"><PtsDelta delta={totalDelta} /></td>
            </tr>
          </thead>
          <tbody>
            {(scenarioWeek.starters || []).map((p, i) => renderStarterRow(p, i))}
          </tbody>
        </table>
      </div>

      {/* ── Bench ── */}
      <div
        className="scenario-week-section scenario-week-section--bench"
        style={startersHeight ? { height: `${startersHeight}px`, overflow: 'hidden' } : {}}
      >
        {/* Totals row uses same flex structure as bench items — guarantees column alignment */}
        <div className="scenario-week-bench-item scenario-week-bench-totals">
          <div className="scenario-week-bench-player">
            <span className="scenario-week-section-label">Bench</span>
          </div>
          <span className="scenario-week-bench-pts scenario-week-totals-pts">{scenBenchTotal.toFixed(1)}</span>
          <span className="scenario-week-bench-delta-col"><PtsDelta delta={benchTotalDelta} /></span>
          <button
            className="scenario-week-bench-toggle"
            onClick={() => setBenchExpanded((v) => !v)}
            aria-expanded={benchExpanded}
          >
            {benchExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className={`scenario-week-bench-grid${benchExpanded ? '' : ' scenario-week-bench-grid--collapsed'}`}>
          {sortedBench.map((p, i) => renderBenchItem(p, i))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * ScenarioTeamDetail
 *
 * Per-team analysis panel shown when a team is selected in the standings.
 * Displays:
 *   - Team header (avatar + name)
 *   - Weekly scoring line chart: original optimal vs scenario optimal
 *
 * Props:
 *   rosterId             – selected team's roster ID
 *   teamsForGrid         – [{ rosterId, teamName, avatarUrl }]
 *   originalWeeklyScores – { [rosterId]: [{ starterTotal }] } indexed 0-16
 *   scenarioWeeklyScores – same, with scenario roster
 *   playersData          – player metadata lookup
 *   playerIdMap          – ESPN <-> Sleeper ID map
 */
function ScenarioTeamDetail({ rosterId, teamsForGrid, originalWeeklyScores, scenarioWeeklyScores, playersData, playerIdMap }) {
  const team = (teamsForGrid || []).find((t) => t.rosterId === rosterId) || {};

  const [selectedWeek, setSelectedWeek] = useState(1);

  // Reset week to 1 whenever the selected team changes
  useEffect(() => { setSelectedWeek(1); }, [rosterId]);

  const chartData = useMemo(() => {
    const origWeeks = (originalWeeklyScores || {})[rosterId] || [];
    const scenWeeks = (scenarioWeeklyScores || {})[rosterId] || [];
    return Array.from({ length: 17 }, (_, i) => ({
      week:     `W${i + 1}`,
      original: Number(((origWeeks[i] || {}).starterTotal || 0).toFixed(2)),
      scenario: Number(((scenWeeks[i] || {}).starterTotal || 0).toFixed(2)),
    }));
  }, [rosterId, originalWeeklyScores, scenarioWeeklyScores]);

  // Y-axis domain: pad 5 pts below min and above max
  const { yMin, yMax } = useMemo(() => {
    const vals = chartData.flatMap((d) => [d.original, d.scenario]).filter((v) => v > 0);
    if (vals.length === 0) return { yMin: 0, yMax: 200 };
    const raw_min = Math.min(...vals);
    const raw_max = Math.max(...vals);
    return {
      yMin: Math.max(0, Math.floor((raw_min - 10) / 10) * 10),
      yMax: Math.ceil((raw_max + 10) / 10) * 10,
    };
  }, [chartData]);

  return (
    <div className="scenario-team-detail">
      {/* ── Header ── */}
      <div className="scenario-team-detail-header">
        <span className="scenario-team-detail-label">Viewing:</span>
        {team.avatarUrl
          ? <img className="scenario-team-detail-avatar" src={team.avatarUrl} alt="" />
          : <span className="scenario-team-detail-avatar scenario-team-detail-avatar--placeholder" />
        }
        <span className="scenario-team-detail-name">{team.teamName || `Team ${rosterId}`}</span>
      </div>

      {/* ── Weekly scoring chart ── */}
      <div className="scenario-team-detail-section">
        <div className="scenario-team-detail-section-title">Weekly Scoring</div>
        <div className="scenario-team-detail-section-subtitle">
          Optimal lineup score each week — original roster vs scenario roster
        </div>

        <div className="scenario-team-detail-chart">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,160,0.15)" />
              <XAxis
                dataKey="week"
                tick={{ fill: 'rgba(170,175,220,0.6)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(120,120,160,0.2)' }}
                tickLine={false}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: 'rgba(170,175,220,0.6)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              {/* Playoff start reference */}
              <ReferenceLine
                x="W15"
                stroke="rgba(180,140,40,0.4)"
                strokeDasharray="4 3"
                label={{ value: 'Playoffs', position: 'insideTopRight', fill: 'rgba(180,140,40,0.6)', fontSize: 10 }}
              />
              <Tooltip content={<WeeklyTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '0.78rem', paddingTop: '8px', color: 'rgba(170,175,220,0.7)' }}
                formatter={(value) => value === 'original' ? 'Original' : 'Scenario'}
              />
              <Line
                type="monotone"
                dataKey="original"
                stroke="rgba(140,160,220,0.65)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'rgba(140,160,220,0.65)', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: 'rgba(140,160,220,0.9)' }}
                strokeDasharray="5 3"
              />
              <Line
                type="monotone"
                dataKey="scenario"
                stroke="#7c9cff"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#7c9cff', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#a0b8ff' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Weekly lineup breakdown ── */}
      <div className="scenario-team-detail-section">
        <div className="scenario-team-detail-section-title">Weekly Lineup</div>
        <div className="scenario-team-detail-section-subtitle">
          Scenario optimal lineup — scores vs original roster
        </div>
        <div className="scenario-week-selector-wrap">
          <WeekSelector week={selectedWeek} onChange={setSelectedWeek} minWeek={1} maxWeek={17} />
        </div>
        <ScenarioWeekTable
          scenarioWeek={(scenarioWeeklyScores[rosterId] || [])[selectedWeek - 1] || null}
          originalWeek={(originalWeeklyScores[rosterId] || [])[selectedWeek - 1] || null}
          playersData={playersData}
          playerIdMap={playerIdMap}
        />
      </div>
    </div>
  );
}

export default ScenarioTeamDetail;
