import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';

// ── FP rank badge (Future Scenarios only) ─────────────────────────────────────

/**
 * Shows a small badge next to a player indicating:
 *  - Green "TE12" if the player is ranked in FantasyPros (with hover tooltip naming
 *    the historical player whose stats are being slotted in)
 *  - Red "not ranked" if the player has no FP rank (will project to 0 pts)
 *
 * All props are optional — when fpRankings is null/undefined the component
 * renders nothing, so it's safe to include in non-future-scenario views.
 */
function playerName(p) {
  if (!p) return null;
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
}

// ── Position rank list modal ───────────────────────────────────────────────────

function FpRankListModal({ position, rank, posRanks, projectionYear, playersData, onClose }) {
  const scoringNote = position === 'TE' ? 'half-PPR' : 'standard';

  return createPortal(
    <div className="player-modal-overlay" onClick={onClose}>
      <div
        className="player-modal fp-rank-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="player-card-close" aria-label="Close" onClick={onClose}>×</button>

        <div className="fp-rank-modal-header">
          <span className="fp-rank-modal-title">{position} Rankings</span>
          {projectionYear && (
            <span className="fp-rank-modal-subtitle">{projectionYear} season · {scoringNote}</span>
          )}
        </div>

        <div className="fp-rank-modal-scroll">
          <table className="fp-rank-modal-table">
            <thead>
              <tr>
                <th className="fp-rank-modal-th fp-rank-modal-th--rank">#</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--name">Player</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--pts">Pts</th>
              </tr>
            </thead>
            <tbody>
              {(posRanks || []).map((entry, i) => {
                const name = playerName(playersData && playersData[entry.sleeperId]);
                const isActive = i + 1 === rank;
                return (
                  <tr
                    key={entry.sleeperId}
                    className={`fp-rank-modal-row${isActive ? ' fp-rank-modal-row--active' : ''}`}
                  >
                    <td className="fp-rank-modal-td fp-rank-modal-td--rank">{i + 1}</td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--name">
                      {name || <span className="fp-rank-modal-unknown">{entry.sleeperId}</span>}
                    </td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--pts">
                      {entry.scoringPts.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Badge component ────────────────────────────────────────────────────────────

function FpRankBadge({ playerId, fpRankings, historicalPositionRanks, projectionYear, playersData }) {
  const [tipPos, setTipPos]     = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  if (!fpRankings) return null;

  const fpInfo = fpRankings[playerId];

  if (!fpInfo) {
    return (
      <span
        className="fp-rank-badge fp-rank-badge--not-found"
        title="Player not found in FantasyPros rankings — will project as 0 pts"
      >
        not ranked
      </span>
    );
  }

  const { rank, position } = fpInfo;

  // Each posRanks entry is { sleeperId, scoringPts } (see historicalRankingsBuilder)
  const posRanks            = historicalPositionRanks && historicalPositionRanks[position];
  const historicalEntry     = posRanks && posRanks[rank - 1];
  const historicalPlayer    = historicalEntry && playersData && playersData[historicalEntry.sleeperId];
  const historicalPlayerName = playerName(historicalPlayer);

  const label   = `${position}${rank}`;
  const tooltip = historicalPlayerName && projectionYear
    ? `${historicalPlayerName}, ${projectionYear} season`
    : projectionYear
      ? `${position} rank ${rank} (${projectionYear} season)`
      : `${position} rank ${rank}`;

  return (
    <>
      <span
        className="fp-rank-tooltip-wrap"
        onMouseEnter={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e)  => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTipPos(null)}
        onClick={(e) => { e.stopPropagation(); setTipPos(null); setModalOpen(true); }}
      >
        <span className="fp-rank-badge fp-rank-badge--found fp-rank-badge--clickable">{label}</span>
      </span>

      {tipPos && !modalOpen && (
        <span
          className="fp-rank-tooltip-fixed"
          style={{ right: window.innerWidth - tipPos.x + 8, top: tipPos.y - 36 }}
        >
          {tooltip}
        </span>
      )}

      {modalOpen && posRanks && (
        <FpRankListModal
          position={position}
          rank={rank}
          posRanks={posRanks}
          projectionYear={projectionYear}
          playersData={playersData}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

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
          style={{ right: window.innerWidth - tipPos.x + 8, top: tipPos.y - 36 }}
        >
          {tooltip}
        </span>
      )}
    </>
  );
}

// ── Per-week starters / bench table ──────────────────────────────────────────

function ScenarioWeekTable({
  scenarioWeek, originalWeek, playersData, playerIdMap, onPlayerClick,
  fpRankings, historicalPositionRanks, projectionYear,
}) {
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
      <tr
        key={`s-${p.id}-${i}`}
        className={`scenario-week-row${info ? ' player-clickable' : ''}`}
        onClick={() => info && onPlayerClick && onPlayerClick(info)}
      >
        <td className="scenario-week-pos">{posLabel}</td>
        <td className="scenario-week-player">
          <div className="scenario-week-player-inner">
            <img src={logo} alt="" className="scenario-week-avatar" />
            <span className="scenario-week-name">{name}</span>
            {pos  && <span className="scenario-week-meta">{pos}</span>}
            {team && <span className="scenario-week-meta scenario-week-team">{team}</span>}
            <FpRankBadge
              playerId={p.id}
              fpRankings={fpRankings}
              historicalPositionRanks={historicalPositionRanks}
              projectionYear={projectionYear}
              playersData={playersData}
            />
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
      <div
        key={p.id}
        className={`scenario-week-bench-item${info ? ' player-clickable' : ''}`}
        onClick={() => info && onPlayerClick && onPlayerClick(info)}
      >
        <div className="scenario-week-bench-player">
          <img src={logo} alt="" className="scenario-week-avatar" />
          <span className="scenario-week-name">{name}</span>
          {pos && <span className="scenario-week-meta">{pos}</span>}
          <FpRankBadge
            playerId={p.id}
            fpRankings={fpRankings}
            historicalPositionRanks={historicalPositionRanks}
            projectionYear={projectionYear}
            playersData={playersData}
          />
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

// ── Position impact summary table ─────────────────────────────────────────────

function SlotWeekTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload || {};
  const origVal = d.original || 0;
  const scenVal = d.scenario || 0;
  const delta = scenVal - origVal;
  const playerChanged = d.originalPlayer && d.scenarioPlayer && d.originalPlayer !== d.scenarioPlayer;

  return (
    <div className="scenario-chart-tooltip">
      <div className="scenario-chart-tooltip-week">{label}</div>
      <div className="scenario-chart-tooltip-row">
        <span className="scenario-chart-tooltip-dot scenario-chart-tooltip-dot--original" />
        <span className="scenario-chart-tooltip-label">{d.originalPlayer || 'Original'}</span>
        <span className="scenario-chart-tooltip-val">{origVal.toFixed(1)}</span>
      </div>
      <div className="scenario-chart-tooltip-row">
        <span className="scenario-chart-tooltip-dot scenario-chart-tooltip-dot--scenario" />
        <span className="scenario-chart-tooltip-label">{d.scenarioPlayer || 'Scenario'}</span>
        <span className="scenario-chart-tooltip-val">{scenVal.toFixed(1)}</span>
      </div>
      {playerChanged && (
        <div className="scenario-chart-tooltip-player-change">
          swap
        </div>
      )}
      {Math.abs(delta) >= 0.05 && (
        <div className={`scenario-chart-tooltip-delta ${delta > 0 ? 'scenario-chart-tooltip-delta--pos' : 'scenario-chart-tooltip-delta--neg'}`}>
          {delta > 0 ? '+' : ''}{delta.toFixed(1)}
        </div>
      )}
    </div>
  );
}

function PositionSlotChart({ weekly, showPlayoffLine = true }) {
  const { yMin, yMax } = useMemo(() => {
    const vals = weekly.flatMap((d) => [d.original, d.scenario]).filter((v) => v > 0);
    if (vals.length === 0) return { yMin: 0, yMax: 50 };
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    return {
      yMin: Math.max(0, Math.floor((rawMin - 5) / 5) * 5),
      yMax: Math.ceil((rawMax + 5) / 5) * 5,
    };
  }, [weekly]);

  return (
    <div className="scenario-pos-impact-chart">
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={weekly} margin={{ top: 6, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,160,0.12)" />
          <XAxis
            dataKey="week"
            tick={{ fill: 'rgba(170,175,220,0.5)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(120,120,160,0.15)' }}
            tickLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: 'rgba(170,175,220,0.5)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          {showPlayoffLine && (
            <ReferenceLine
              x="W15"
              stroke="rgba(180,140,40,0.35)"
              strokeDasharray="4 3"
              label={{ value: 'Playoffs', position: 'insideTopRight', fill: 'rgba(180,140,40,0.5)', fontSize: 9 }}
            />
          )}
          <Tooltip content={<SlotWeekTooltip />} />
          <Line
            type="monotone"
            dataKey="original"
            stroke="rgba(140,160,220,0.55)"
            strokeWidth={1.5}
            dot={{ r: 2.5, fill: 'rgba(140,160,220,0.55)', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            strokeDasharray="5 3"
          />
          <Line
            type="monotone"
            dataKey="scenario"
            stroke="#7c9cff"
            strokeWidth={2}
            dot={{ r: 2.5, fill: '#7c9cff', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#a0b8ff' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const RANGE_OPTIONS = [
  { key: 'reg',     label: 'Reg Season', start: 0,  end: 14 },
  { key: 'full',    label: 'Full Season', start: 0,  end: 17 },
  { key: 'playoff', label: 'Playoffs',   start: 14, end: 17 },
];

function PositionImpactTable({ originalWeeklyScores, scenarioWeeklyScores, rosterId, playersData, playerIdMap }) {
  const [expandedPos, setExpandedPos] = useState(null);
  const [weekRange, setWeekRange] = useState('reg');

  useEffect(() => { setExpandedPos(null); }, [rosterId]);
  useEffect(() => { setExpandedPos(null); }, [weekRange]);

  // Build all 17 weeks per slot (expensive — player lookups). Only re-runs on roster/player data change.
  const baseRows = useMemo(() => {
    const origWeeks = (originalWeeklyScores || {})[rosterId] || [];
    const scenWeeks = (scenarioWeeklyScores || {})[rosterId] || [];
    const impactMap = {};

    for (let wi = 0; wi < 17; wi++) {
      const origStarters = origWeeks[wi]?.starters || [];
      const scenStarters = scenWeeks[wi]?.starters || [];
      scenStarters.forEach((p, i) => {
        const slot = STARTER_POSITION_NAMES[i] || `S${i + 1}`;
        if (!impactMap[slot]) impactMap[slot] = { idx: i, weekly: [] };
        const scenPts = p.pts || 0;
        const origPts = origStarters[i]?.pts || 0;
        const origId = origStarters[i]?.id;
        const scenId = p.id;
        const origInfo = origId && origId !== '0' ? getPlayerInfo(origId, playersData, playerIdMap) : null;
        const scenInfo = scenId && scenId !== '0' ? getPlayerInfo(scenId, playersData, playerIdMap) : null;
        impactMap[slot].weekly.push({
          week: `W${wi + 1}`,
          original: Number(origPts.toFixed(2)),
          scenario: Number(scenPts.toFixed(2)),
          originalPlayer: origInfo?.name || '—',
          scenarioPlayer: scenInfo?.name || '—',
        });
      });
    }

    return Object.entries(impactMap)
      .sort(([, a], [, b]) => a.idx - b.idx)
      .map(([pos, { idx, weekly }]) => ({ pos, idx, weekly }));
  }, [rosterId, originalWeeklyScores, scenarioWeeklyScores, playersData, playerIdMap]);

  // Derive per-range totals from the base rows (cheap).
  const rows = useMemo(() => {
    const { start, end } = RANGE_OPTIONS.find((r) => r.key === weekRange);
    return baseRows.map(({ pos, idx, weekly }) => {
      const slice = weekly.slice(start, end);
      const scenTotal  = slice.reduce((s, w) => s + w.scenario, 0);
      const origTotal  = slice.reduce((s, w) => s + w.original, 0);
      const weeksUp    = slice.filter((w) => w.scenario - w.original > 0.05).length;
      const weeksDown  = slice.filter((w) => w.original - w.scenario > 0.05).length;
      return { pos, idx, weekly: slice, scenTotal, origTotal, delta: scenTotal - origTotal, weeksUp, weeksDown };
    });
  }, [baseRows, weekRange]);

  if (rows.length === 0) return null;

  const totalScen      = rows.reduce((s, r) => s + r.scenTotal, 0);
  const totalOrig      = rows.reduce((s, r) => s + r.origTotal, 0);
  const totalDelta     = totalScen - totalOrig;
  const totalWeeksUp   = rows.reduce((s, r) => s + r.weeksUp, 0);
  const totalWeeksDown = rows.reduce((s, r) => s + r.weeksDown, 0);

  const countCell = (n, cls) =>
    n > 0
      ? <span className={cls}>{n}</span>
      : <span className="scenario-pos-impact-neutral">—</span>;

  return (
    <div className="scenario-pos-impact">
      <div className="scenario-pos-impact-range-toggle">
        {RANGE_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            className={`scenario-pos-impact-range-btn${weekRange === key ? ' scenario-pos-impact-range-btn--active' : ''}`}
            onClick={() => setWeekRange(key)}
          >{label}</button>
        ))}
      </div>
      <table className="scenario-pos-impact-tbl">
        <thead>
          <tr>
            <th className="scenario-pos-impact-th scenario-pos-impact-th--pos">Pos</th>
            <th className="scenario-pos-impact-th scenario-pos-impact-th--num">Original</th>
            <th className="scenario-pos-impact-th scenario-pos-impact-th--num">Scenario</th>
            <th className="scenario-pos-impact-th scenario-pos-impact-th--num">Impact</th>
            <th
              className="scenario-pos-impact-th scenario-pos-impact-th--num"
              title="Weeks where the scenario lineup scored higher at this position"
            >Wks ↑</th>
            <th
              className="scenario-pos-impact-th scenario-pos-impact-th--num"
              title="Weeks where the scenario lineup scored lower at this position"
            >Wks ↓</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pos, scenTotal, origTotal, delta, weeksUp, weeksDown, weekly }) => {
            const isExpanded = expandedPos === pos;
            return (
              <React.Fragment key={pos}>
                <tr
                  className={`scenario-pos-impact-row scenario-pos-impact-row--clickable${isExpanded ? ' scenario-pos-impact-row--expanded' : ''}`}
                  onClick={() => setExpandedPos(isExpanded ? null : pos)}
                >
                  <td className="scenario-pos-impact-pos">
                    <span className={`scenario-pos-impact-chevron${isExpanded ? ' scenario-pos-impact-chevron--open' : ''}`}>▶</span>
                    {pos}
                  </td>
                  <td className="scenario-pos-impact-num scenario-pos-impact-num--muted">{origTotal.toFixed(1)}</td>
                  <td className="scenario-pos-impact-num">{scenTotal.toFixed(1)}</td>
                  <td className="scenario-pos-impact-num">
                    {Math.abs(delta) < 0.05
                      ? <span className="scenario-pos-impact-neutral">—</span>
                      : <span className={delta > 0 ? 'scenario-pos-impact-delta--pos' : 'scenario-pos-impact-delta--neg'}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                        </span>
                    }
                  </td>
                  <td className="scenario-pos-impact-num">{countCell(weeksUp, 'scenario-pos-impact-delta--pos')}</td>
                  <td className="scenario-pos-impact-num">{countCell(weeksDown, 'scenario-pos-impact-delta--neg')}</td>
                </tr>
                {isExpanded && (
                  <tr className="scenario-pos-impact-chart-row">
                    <td colSpan={6} className="scenario-pos-impact-chart-cell">
                      <PositionSlotChart weekly={weekly} showPlayoffLine={weekRange !== 'playoff'} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="scenario-pos-impact-total-row">
            <td className="scenario-pos-impact-pos scenario-pos-impact-pos--total">Total</td>
            <td className="scenario-pos-impact-num scenario-pos-impact-num--muted">{totalOrig.toFixed(1)}</td>
            <td className="scenario-pos-impact-num">{totalScen.toFixed(1)}</td>
            <td className="scenario-pos-impact-num">
              {Math.abs(totalDelta) < 0.05
                ? <span className="scenario-pos-impact-neutral">—</span>
                : <span className={totalDelta > 0 ? 'scenario-pos-impact-delta--pos' : 'scenario-pos-impact-delta--neg'}>
                    {totalDelta > 0 ? '+' : ''}{totalDelta.toFixed(1)}
                  </span>
              }
            </td>
            <td className="scenario-pos-impact-num">{countCell(totalWeeksUp, 'scenario-pos-impact-delta--pos')}</td>
            <td className="scenario-pos-impact-num">{countCell(totalWeeksDown, 'scenario-pos-impact-delta--neg')}</td>
          </tr>
        </tfoot>
      </table>
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
function ScenarioTeamDetail({
  rosterId, teamsForGrid, originalWeeklyScores, scenarioWeeklyScores, playersData, playerIdMap,
  fpRankings, historicalPositionRanks, projectionYear,
}) {
  const team = (teamsForGrid || []).find((t) => t.rosterId === rosterId) || {};

  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

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
          onPlayerClick={setSelectedPlayer}
          fpRankings={fpRankings}
          historicalPositionRanks={historicalPositionRanks}
          projectionYear={projectionYear}
        />
      </div>

      {/* ── Delta by position ── */}
      <div className="scenario-team-detail-section">
        <div className="scenario-team-detail-section-title">Delta by Position</div>
        <div className="scenario-team-detail-section-subtitle">
          Season-long point totals per lineup slot — original vs scenario
        </div>
        <PositionImpactTable
          originalWeeklyScores={originalWeeklyScores}
          scenarioWeeklyScores={scenarioWeeklyScores}
          rosterId={rosterId}
          playersData={playersData}
          playerIdMap={playerIdMap}
        />
      </div>
      {selectedPlayer && createPortal(
        <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
          <div className="player-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <PlayerWeeklyScores
              player={selectedPlayer}
              onClose={() => setSelectedPlayer(null)}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ScenarioTeamDetail;
