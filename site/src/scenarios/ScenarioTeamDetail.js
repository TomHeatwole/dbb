import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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
import { fetchRedraftValueData } from '../lookups/RedraftValueLookup';
import { computeTeamLuckMetrics, percentileColor, formatRollPercentile } from './luckMetrics';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import PositionBadge from '../PositionBadge';
import { computePlayerRosterStats } from './computeScenarioEval';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

function buildSeasonTotalsMap(playerWeeklyPoints) {
  const totals = {};
  for (const weekPts of playerWeeklyPoints || []) {
    for (const [pid, pts] of Object.entries(weekPts || {})) {
      totals[pid] = (totals[pid] || 0) + pts;
    }
  }
  return totals;
}

// ── Outcome projection badge (Future Scenarios v2) ────────────────────────────

/**
 * Human-readable label for a synthetic outcome, e.g.
 * "Josh Jacobs 2022 + Raheem Mostert 2023" or "Cooper Kupp 2021 ×1.12".
 */
function syntheticOutcomeLabel(outcome, playersData) {
  const parts = (outcome.parents || []).map((p) => {
    const name = playerName(playersData && playersData[p.sleeperId]) || p.sleeperId;
    return `${name} ${p.seasonYear}`;
  });
  if (outcome.extrapolation) {
    const rarity = outcome.survivalP > 0
      ? `1-in-${Math.round(1 / outcome.survivalP).toLocaleString()}`
      : null;
    const scale = `×${Number(outcome.scale).toFixed(2)}`;
    const base = `${parts[0] || '?'} ${scale}`;
    return rarity ? `${base} · ${rarity}` : base;
  }
  return parts.join(' + ');
}

function OutcomeListModal({
  projection, playersData, onClose, onPercentileChange,
}) {
  const [localPercentile, setLocalPercentile] = useState(projection?.percentile ?? 50);

  useEffect(() => {
    setLocalPercentile(projection?.percentile ?? 50);
  }, [projection?.percentile, projection?.selectedIndex]);

  if (!projection) return null;

  const { adpLabel, position, outcomes, selectedIndex } = projection;
  const scoringNote = position === 'TE' ? 'half-PPR' : 'standard';

  const handleApply = () => {
    if (onPercentileChange) onPercentileChange(localPercentile);
    onClose();
  };

  return createPortal(
    <div className="player-modal-overlay" onClick={onClose}>
      <div
        className="player-modal fp-rank-modal outcome-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="player-card-close" aria-label="Close" onClick={onClose}>×</button>

        <div className="fp-rank-modal-header">
          <span className="fp-rank-modal-title">{adpLabel} — Regular-season outcomes</span>
          <span className="fp-rank-modal-subtitle">
            Past 5 seasons · {scoringNote} · sorted by season points · supplies weeks 1–14
          </span>
        </div>

        <div className="outcome-modal-controls">
          <label className="outcome-modal-percentile-label" htmlFor="outcome-percentile-input">
            Percentile roll
          </label>
          <input
            id="outcome-percentile-input"
            type="range"
            min={0}
            max={100}
            step={0.01}
            value={localPercentile}
            onChange={(e) => setLocalPercentile(Number(e.target.value))}
            className="outcome-modal-slider"
          />
          <span className="outcome-modal-percentile-value">P{formatRollPercentile(localPercentile)}</span>
          <button type="button" className="outcome-modal-apply-btn" onClick={handleApply}>
            Apply
          </button>
        </div>

        <div className="fp-rank-modal-scroll">
          <table className="fp-rank-modal-table">
            <thead>
              <tr>
                <th className="fp-rank-modal-th fp-rank-modal-th--rank">#</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--name">Player · Season</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--adp">ADP</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--pts">Finish</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--pts">Pts</th>
              </tr>
            </thead>
            <tbody>
              {(outcomes || []).map((entry, i) => {
                const isActive = i === selectedIndex;
                const rowKey = entry.synthetic
                  ? `synth-${i}`
                  : `${entry.sleeperId}-${entry.seasonYear}-${i}`;

                const nameCell = entry.synthetic
                  ? (
                    <>
                      <span className="outcome-modal-weight">{entry.survivalP ? 'open tail · ' : 'synthetic · '}</span>
                      {syntheticOutcomeLabel(entry, playersData)}
                    </>
                  )
                  : (
                    <>
                      {playerName(playersData && playersData[entry.sleeperId]) || entry.sleeperId}
                      <span className="outcome-modal-season"> · {entry.seasonYear}</span>
                    </>
                  );

                const adpStr = entry.synthetic
                  ? '—'
                  : (entry.adpRank != null
                    ? `${position}${entry.adpRank}`
                    : `${position}${Math.round(entry.effRank)}`);

                return (
                  <tr
                    key={rowKey}
                    className={`fp-rank-modal-row${isActive ? ' fp-rank-modal-row--active' : ''}`}
                  >
                    <td className="fp-rank-modal-td fp-rank-modal-td--rank">{i + 1}</td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--name">{nameCell}</td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--adp">{adpStr}</td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--pts">
                      {entry.outcomeRank != null ? `${position}${entry.outcomeRank}` : '—'}
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

function PlayoffOutcomeModal({
  projection, playersData, onClose, onPlayoffPercentileChange,
}) {
  const [localPercentile, setLocalPercentile] = useState(projection?.playoffPercentile ?? 50);

  useEffect(() => {
    setLocalPercentile(projection?.playoffPercentile ?? 50);
  }, [projection?.playoffPercentile, projection?.selectedPlayoffIndex]);

  if (!projection) return null;

  const { adpLabel, playoffOutcomes, selectedPlayoffIndex, regularSeasonPts } = projection;
  const rsLabel = regularSeasonPts != null ? `${regularSeasonPts.toFixed(0)} pts in weeks 1–14` : 'this regular season';

  const handleApply = () => {
    if (onPlayoffPercentileChange) onPlayoffPercentileChange(localPercentile);
    onClose();
  };

  return createPortal(
    <div className="player-modal-overlay" onClick={onClose}>
      <div
        className="player-modal fp-rank-modal outcome-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="player-card-close" aria-label="Close" onClick={onClose}>×</button>

        <div className="fp-rank-modal-header">
          <span className="fp-rank-modal-title">{adpLabel} — Playoff outcomes</span>
          <span className="fp-rank-modal-subtitle">
            Real weeks 15–17 from historical seasons with similar regular-season scoring
            ({rsLabel})
          </span>
        </div>

        <div className="outcome-modal-controls">
          <label className="outcome-modal-percentile-label" htmlFor="playoff-percentile-input">
            Playoff percentile
          </label>
          <input
            id="playoff-percentile-input"
            type="range"
            min={0}
            max={100}
            step={0.01}
            value={localPercentile}
            onChange={(e) => setLocalPercentile(Number(e.target.value))}
            className="outcome-modal-slider"
          />
          <span className="outcome-modal-percentile-value">P{formatRollPercentile(localPercentile)}</span>
          <button type="button" className="outcome-modal-apply-btn" onClick={handleApply}>
            Apply
          </button>
        </div>

        <div className="fp-rank-modal-scroll">
          <table className="fp-rank-modal-table">
            <thead>
              <tr>
                <th className="fp-rank-modal-th fp-rank-modal-th--rank">#</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--name">Player · Season</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--pts">RS 1–14</th>
                <th className="fp-rank-modal-th fp-rank-modal-th--pts">W15–17</th>
              </tr>
            </thead>
            <tbody>
              {(playoffOutcomes || []).map((entry, i) => {
                const isActive = i === selectedPlayoffIndex;
                const name = playerName(playersData && playersData[entry.sleeperId]) || entry.sleeperId;
                return (
                  <tr
                    key={`${entry.sleeperId}-${entry.seasonYear}-${i}`}
                    className={`fp-rank-modal-row${isActive ? ' fp-rank-modal-row--active' : ''}`}
                  >
                    <td className="fp-rank-modal-td fp-rank-modal-td--rank">{i + 1}</td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--name">
                      {name}
                      <span className="outcome-modal-season"> · {entry.seasonYear}</span>
                    </td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--pts">
                      {entry.regPts.toFixed(1)}
                    </td>
                    <td className="fp-rank-modal-td fp-rank-modal-td--pts">
                      {entry.poTotal.toFixed(1)}
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

function playoffOutcomeLabel(outcome, playersData) {
  if (!outcome) return null;
  const name = playerName(playersData && playersData[outcome.sleeperId]) || outcome.sleeperId;
  return `${name} ${outcome.seasonYear} W15–17`;
}

function OutcomeProjectionPills({
  projection,
  playersData,
  onPercentileChange,
  onPlayoffPercentileChange,
  playerId,
  showAdp = true,
  showRoll = true,
  showPlayoffRoll = false,
}) {
  const [tipPos, setTipPos] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [playoffModalOpen, setPlayoffModalOpen] = useState(false);

  if (!projection || projection.unranked) {
    if (!showAdp && !showRoll && !showPlayoffRoll) return null;
    return (
      <span
        className="fp-rank-badge fp-rank-badge--not-found"
        title="Player not found in Hwang ADP — will project as 0 pts"
      >
        not ranked
      </span>
    );
  }

  const { adpLabel, percentile, selectedOutcome, position, playoffPercentile, selectedPlayoffOutcome } = projection;
  const historicalPlayer = selectedOutcome
    && playersData
    && playersData[selectedOutcome.sleeperId];
  const historicalPlayerName = playerName(historicalPlayer);
  const outcomeRank = selectedOutcome?.outcomeRank;
  const rollColor = percentileColor(percentile);
  const playoffColor = percentileColor(playoffPercentile);

  const rsBit = selectedOutcome?.synthetic
    ? `Synthetic weeks 1–14 · ${syntheticOutcomeLabel(selectedOutcome, playersData)} · P${formatRollPercentile(percentile)}`
    : historicalPlayerName && selectedOutcome
      ? `${historicalPlayerName}, ${selectedOutcome.seasonYear} weeks 1–14 · finish ${position}${outcomeRank ?? '?'} · P${formatRollPercentile(percentile)}`
      : `${adpLabel} outcome pool · P${formatRollPercentile(percentile)}`;
  const poBit = selectedPlayoffOutcome
    ? `Playoff · ${playoffOutcomeLabel(selectedPlayoffOutcome, playersData)} · ${selectedPlayoffOutcome.poTotal.toFixed(1)} pts · P${formatRollPercentile(playoffPercentile)} given this regular season`
    : playoffPercentile != null
      ? `Playoff P${formatRollPercentile(playoffPercentile)} given this regular season`
      : null;
  const tooltip = poBit ? `${rsBit} · ${poBit}` : rsBit;

  const openModal = (e) => {
    e.stopPropagation();
    setTipPos(null);
    setModalOpen(true);
  };
  const openPlayoffModal = (e) => {
    e.stopPropagation();
    setTipPos(null);
    setPlayoffModalOpen(true);
  };

  const pills = (
    <>
      {showAdp && (
        <span
          className="fp-rank-badge fp-rank-badge--found fp-rank-badge--clickable outcome-adp-pill"
          onClick={openModal}
        >
          {adpLabel}
        </span>
      )}
      {showRoll && percentile != null && (
        <span
          className="outcome-roll-badge fp-rank-badge--clickable"
          style={{ '--roll-color': rollColor }}
          onClick={openModal}
        >
          <span className="outcome-roll-pct">P{formatRollPercentile(percentile)}</span>
          {outcomeRank != null && (
            <span className="outcome-roll-finish">{position}{outcomeRank}</span>
          )}
        </span>
      )}
      {showPlayoffRoll && playoffPercentile != null && (
        <span
          className="outcome-roll-badge outcome-roll-badge--playoff fp-rank-badge--clickable"
          style={{ '--roll-color': playoffColor }}
          onClick={openPlayoffModal}
        >
          <span className="outcome-roll-kind">Yoff</span>
          <span className="outcome-roll-pct">P{formatRollPercentile(playoffPercentile)}</span>
        </span>
      )}
    </>
  );

  if (!showAdp && !showRoll && !showPlayoffRoll) return null;

  return (
    <>
      <span
        className="outcome-projection-pills fp-rank-tooltip-wrap"
        onMouseEnter={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTipPos(null)}
      >
        {pills}
      </span>

      {tipPos && !modalOpen && !playoffModalOpen && (
        <span
          className="fp-rank-tooltip-fixed"
          style={{ right: window.innerWidth - tipPos.x + 8, top: tipPos.y - 36 }}
        >
          {tooltip}
        </span>
      )}

      {modalOpen && (
        <OutcomeListModal
          projection={projection}
          playersData={playersData}
          onClose={() => setModalOpen(false)}
          onPercentileChange={(p) => onPercentileChange && onPercentileChange(playerId, p)}
        />
      )}
      {playoffModalOpen && (
        <PlayoffOutcomeModal
          projection={projection}
          playersData={playersData}
          onClose={() => setPlayoffModalOpen(false)}
          onPlayoffPercentileChange={(p) => onPlayoffPercentileChange && onPlayoffPercentileChange(playerId, p)}
        />
      )}
    </>
  );
}

function OutcomeProjectionBadge({
  playerId, playerProjections, playersData, onPercentileChange, onPlayoffPercentileChange,
}) {
  if (!playerProjections) return null;
  const proj = playerProjections[playerId];
  return (
    <OutcomeProjectionPills
      playerId={playerId}
      projection={proj}
      playersData={playersData}
      onPercentileChange={onPercentileChange}
      onPlayoffPercentileChange={onPlayoffPercentileChange}
      showPlayoffRoll
    />
  );
}

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
  playerProjections, onPercentileChange, onPlayoffPercentileChange,
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
            {team && <span className="scenario-week-meta scenario-week-team">{team}</span>}
            {playerProjections ? (
              <OutcomeProjectionBadge
                playerId={p.id}
                playerProjections={playerProjections}
                playersData={playersData}
                onPercentileChange={onPercentileChange}
                onPlayoffPercentileChange={onPlayoffPercentileChange}
              />
            ) : (
              <>
                {pos && <PositionBadge position={pos} />}
                <FpRankBadge
                  playerId={p.id}
                  fpRankings={fpRankings}
                  historicalPositionRanks={historicalPositionRanks}
                  projectionYear={projectionYear}
                  playersData={playersData}
                />
              </>
            )}
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
          {playerProjections ? (
            <OutcomeProjectionBadge
              playerId={p.id}
              playerProjections={playerProjections}
              playersData={playersData}
              onPercentileChange={onPercentileChange}
              onPlayoffPercentileChange={onPlayoffPercentileChange}
            />
          ) : (
            <>
              {pos && <PositionBadge position={pos} />}
              <FpRankBadge
                playerId={p.id}
                fpRankings={fpRankings}
                historicalPositionRanks={historicalPositionRanks}
                projectionYear={projectionYear}
                playersData={playersData}
              />
            </>
          )}
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

// Returns the CSS class for a rank value (green at top, red at bottom).
function rankClass(rank, total) {
  if (!rank || !total) return 'scenario-pos-impact-neutral';
  const pct = rank / total;
  if (pct <= 0.3) return 'scenario-pos-impact-rank--top';
  if (pct >= 0.7) return 'scenario-pos-impact-rank--bot';
  return 'scenario-pos-impact-rank--mid';
}

function RankTooltipContent({ rankings, currentRid, teamsForGrid }) {
  return (
    <table className="pos-rank-tooltip-tbl">
      <tbody>
        {rankings.map((item, i) => {
          const t = (teamsForGrid || []).find((x) => x.rosterId === item.rid);
          const isCurrent = item.rid === currentRid;
          return (
            <tr key={item.rid} className={`pos-rank-tooltip-row${isCurrent ? ' pos-rank-tooltip-row--current' : ''}`}>
              <td className="pos-rank-tooltip-rank">#{i + 1}</td>
              <td className="pos-rank-tooltip-name">{t?.teamName || `Team ${item.rid}`}</td>
              <td className="pos-rank-tooltip-pts">{item.total.toFixed(1)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PositionImpactTable({ originalWeeklyScores, scenarioWeeklyScores, rosterId, playersData, playerIdMap, teamsForGrid }) {
  const [expandedPos, setExpandedPos] = useState(null);
  const [weekRange, setWeekRange] = useState('reg');
  const [rankTip, setRankTip] = useState(null); // { x, y, rankings }

  const showRankTip = useCallback((e, rankings) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setRankTip({ x: rect.left + rect.width / 2, y: rect.top - 6, rankings });
  }, []);
  const hideRankTip = useCallback(() => setRankTip(null), []);

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

  // Derive per-range totals + league rank at each slot.
  const rows = useMemo(() => {
    const { start, end } = RANGE_OPTIONS.find((r) => r.key === weekRange);
    const allRids = Object.keys(scenarioWeeklyScores || {});

    return baseRows.map(({ pos, idx, weekly }) => {
      const slice = weekly.slice(start, end);
      const scenTotal  = slice.reduce((s, w) => s + w.scenario, 0);
      const origTotal  = slice.reduce((s, w) => s + w.original, 0);
      const weeksUp    = slice.filter((w) => w.scenario - w.original > 0.05).length;
      const weeksDown  = slice.filter((w) => w.original - w.scenario > 0.05).length;

      // Rank this team vs every other team at this exact lineup slot over the range.
      const slotRankings = allRids.map((rid) => {
        const weeks = (scenarioWeeklyScores[rid] || []);
        let total = 0;
        for (let wi = start; wi < end; wi++) total += (weeks[wi]?.starters?.[idx]?.pts || 0);
        return { rid: Number(rid), total };
      });
      slotRankings.sort((a, b) => b.total - a.total);
      const scenRank   = slotRankings.findIndex((t) => t.rid === rosterId) + 1;
      const totalTeams = slotRankings.length;

      return { pos, idx, weekly: slice, scenTotal, origTotal, delta: scenTotal - origTotal, weeksUp, weeksDown, scenRank, totalTeams, slotRankings };
    });
  }, [baseRows, weekRange, scenarioWeeklyScores, rosterId]);

  // Overall rank by total starter points across all slots.
  const totalRank = useMemo(() => {
    const { start, end } = RANGE_OPTIONS.find((r) => r.key === weekRange);
    const allRids = Object.keys(scenarioWeeklyScores || {});
    const rankings = allRids.map((rid) => {
      const weeks = (scenarioWeeklyScores[rid] || []);
      let total = 0;
      for (let wi = start; wi < end; wi++) total += (weeks[wi]?.starterTotal || 0);
      return { rid: Number(rid), total };
    });
    rankings.sort((a, b) => b.total - a.total);
    return {
      rank: rankings.findIndex((t) => t.rid === rosterId) + 1,
      totalTeams: rankings.length,
      rankings,
    };
  }, [scenarioWeeklyScores, rosterId, weekRange]);

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

  const rankCell = (rank, total) =>
    rank > 0
      ? <span className={rankClass(rank, total)}>#{rank}</span>
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
              title="League rank at this position slot (scenario lineup, among all teams)"
            >Rank</th>
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
          {rows.map(({ pos, scenTotal, origTotal, delta, weeksUp, weeksDown, weekly, scenRank, totalTeams, slotRankings }) => {
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
                  <td
                    className="scenario-pos-impact-num scenario-pos-impact-num--rank"
                    onMouseEnter={(e) => slotRankings?.length && showRankTip(e, slotRankings)}
                    onMouseLeave={hideRankTip}
                  >{rankCell(scenRank, totalTeams)}</td>
                  <td className="scenario-pos-impact-num">{countCell(weeksUp, 'scenario-pos-impact-delta--pos')}</td>
                  <td className="scenario-pos-impact-num">{countCell(weeksDown, 'scenario-pos-impact-delta--neg')}</td>
                </tr>
                {isExpanded && (
                  <tr className="scenario-pos-impact-chart-row">
                    <td colSpan={7} className="scenario-pos-impact-chart-cell">
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
            <td
              className="scenario-pos-impact-num scenario-pos-impact-num--rank"
              onMouseEnter={(e) => totalRank.rankings?.length && showRankTip(e, totalRank.rankings)}
              onMouseLeave={hideRankTip}
            >{rankCell(totalRank.rank, totalRank.totalTeams)}</td>
            <td className="scenario-pos-impact-num">{countCell(totalWeeksUp, 'scenario-pos-impact-delta--pos')}</td>
            <td className="scenario-pos-impact-num">{countCell(totalWeeksDown, 'scenario-pos-impact-delta--neg')}</td>
          </tr>
        </tfoot>
      </table>
      {rankTip && createPortal(
        <div
          className="pos-rank-tooltip"
          style={{ position: 'fixed', left: rankTip.x, top: rankTip.y, transform: 'translate(-50%, -100%)', zIndex: 9999, pointerEvents: 'none' }}
        >
          <RankTooltipContent rankings={rankTip.rankings} currentRid={rosterId} teamsForGrid={teamsForGrid} />
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Season player stats table ───────────────────────────────────────────────────

function ScenarioPlayerStatsTable({
  rosterId,
  scenarioRosters,
  scenarioWeeklyScores,
  playerWeeklyPoints,
  playersData,
  playerIdMap,
  onPlayerClick,
  playerProjections,
  onPercentileChange,
  onPlayoffPercentileChange,
}) {
  const showProjections = Boolean(playerProjections);

  const playerStats = useMemo(() => {
    if (!scenarioRosters || !playerWeeklyPoints || !scenarioWeeklyScores) return [];
    const rosterPlayerIds = scenarioRosters[rosterId] || [];
    const seasonTotalsMap = buildSeasonTotalsMap(playerWeeklyPoints);
    return computePlayerRosterStats(
      rosterId,
      rosterPlayerIds,
      scenarioWeeklyScores,
      playerWeeklyPoints,
      playersData,
      playerIdMap,
      seasonTotalsMap,
    );
  }, [rosterId, scenarioRosters, scenarioWeeklyScores, playerWeeklyPoints, playersData, playerIdMap]);

  if (playerStats.length === 0) return null;

  return (
    <div className="scenario-player-stats">
      <table className="scenario-player-stats-tbl">
        <thead>
          <tr>
            <th className="scenario-player-stats-th scenario-player-stats-th--player">Player</th>
            {showProjections && (
              <>
                <th
                  className="scenario-player-stats-th scenario-player-stats-th--badge"
                  title="Hwang Adjusted positional ADP"
                >
                  ADP
                </th>
                <th
                  className="scenario-player-stats-th scenario-player-stats-th--badge"
                  title="Percentile roll and rolled outcome finish rank (weeks 1–14)"
                >
                  Roll
                </th>
                <th
                  className="scenario-player-stats-th scenario-player-stats-th--badge"
                  title="Independent playoff percentile given this regular season (weeks 15–17)"
                >
                  Yoff
                </th>
              </>
            )}
            <th className="scenario-player-stats-th scenario-player-stats-th--num">Total Score</th>
            <th
              className="scenario-player-stats-th scenario-player-stats-th--num"
              title="Hwang value over replacement — starter points lost if this player were off the roster"
            >
              HVORP
            </th>
            <th className="scenario-player-stats-th scenario-player-stats-th--num">Started</th>
            <th className="scenario-player-stats-th scenario-player-stats-th--num">Benched</th>
          </tr>
        </thead>
        <tbody>
          {playerStats.map((row) => {
            const info = getPlayerInfo(row.playerId, playersData, playerIdMap);
            const name = info?.name || row.playerId;
            const pos = info?.position || '';
            const logo = getPlayerLogoUrl(info?.espn_photo_url);
            return (
              <tr
                key={row.playerId}
                className={`scenario-player-stats-row${info ? ' player-clickable' : ''}`}
                onClick={() => info && onPlayerClick && onPlayerClick(info)}
              >
                <td className="scenario-player-stats-player">
                  <div className="scenario-week-player-inner">
                    <img src={logo} alt="" className="scenario-week-avatar" />
                    <span className="scenario-week-name">{name}</span>
                    {pos && <PositionBadge position={pos} />}
                  </div>
                </td>
                {showProjections && (
                  <>
                    <td className="scenario-player-stats-badge-col">
                      <OutcomeProjectionPills
                        playerId={row.playerId}
                        projection={playerProjections[row.playerId]}
                        playersData={playersData}
                        onPercentileChange={onPercentileChange}
                        onPlayoffPercentileChange={onPlayoffPercentileChange}
                        showAdp
                        showRoll={false}
                      />
                    </td>
                    <td className="scenario-player-stats-badge-col">
                      <OutcomeProjectionPills
                        playerId={row.playerId}
                        projection={playerProjections[row.playerId]}
                        playersData={playersData}
                        onPercentileChange={onPercentileChange}
                        onPlayoffPercentileChange={onPlayoffPercentileChange}
                        showAdp={false}
                        showRoll
                      />
                    </td>
                    <td className="scenario-player-stats-badge-col">
                      <OutcomeProjectionPills
                        playerId={row.playerId}
                        projection={playerProjections[row.playerId]}
                        playersData={playersData}
                        onPercentileChange={onPercentileChange}
                        onPlayoffPercentileChange={onPlayoffPercentileChange}
                        showAdp={false}
                        showRoll={false}
                        showPlayoffRoll
                      />
                    </td>
                  </>
                )}
                <td className="scenario-player-stats-num">{row.totalScore.toFixed(1)}</td>
                <td className="scenario-player-stats-num scenario-player-stats-num--hvorp">
                  {row.hvorp.toFixed(1)}
                </td>
                <td className="scenario-player-stats-num">{row.weeksStarted}</td>
                <td className="scenario-player-stats-num">{row.weeksBenched}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioLuckSummary({ luckMetrics }) {
  if (!luckMetrics) return null;

  const {
    rollCount,
    rawTotalLuck,
    rawWeightedLuck,
    totalLuckPercentile,
    weightedLuckPercentile,
  } = luckMetrics;

  const fmtRaw = (v) => (v != null ? `P${v.toFixed(1)}` : '—');
  const fmtLuck = (v) => (v != null ? `P${Math.round(v)}` : '—');

  return (
    <div className="scenario-team-detail-luck">
      <div className="scenario-team-detail-luck-item">
        <span className="scenario-team-detail-luck-label">Total luck</span>
        <span
          className="scenario-team-detail-luck-value"
          style={{ '--roll-color': percentileColor(totalLuckPercentile) }}
          title={
            `Avg roll ${fmtRaw(rawTotalLuck)} across ${rollCount} players · ` +
            `${fmtLuck(totalLuckPercentile)} luck if rolls were independent (50 = typical)`
          }
        >
          {fmtLuck(totalLuckPercentile)}
        </span>
        <span className="scenario-team-detail-luck-raw" title="Unadjusted roster average">
          {fmtRaw(rawTotalLuck)} avg
        </span>
      </div>
      {weightedLuckPercentile != null && (
        <div className="scenario-team-detail-luck-item">
          <span className="scenario-team-detail-luck-label">Weighted luck</span>
          <span
            className="scenario-team-detail-luck-value"
            style={{ '--roll-color': percentileColor(weightedLuckPercentile) }}
            title={
              `Comp-adj weighted avg ${fmtRaw(rawWeightedLuck)} · ` +
              `${fmtLuck(weightedLuckPercentile)} luck if rolls were independent (50 = typical)`
            }
          >
            {fmtLuck(weightedLuckPercentile)}
          </span>
          <span className="scenario-team-detail-luck-raw" title="Unadjusted weighted average">
            {fmtRaw(rawWeightedLuck)} avg
          </span>
        </div>
      )}
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
  playerProjections, onPercentileChange, onPlayoffPercentileChange,
  scenarioRosters, playerWeeklyPoints,
}) {
  const team = (teamsForGrid || []).find((t) => t.rosterId === rosterId) || {};
  const showProjections = Boolean(playerProjections);
  const myRosterId = useMyCurrentRosterId();
  const mine = isMyRoster(rosterId, myRosterId);

  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [redraftByName, setRedraftByName] = useState(null);

  // Reset week to 1 whenever the selected team changes
  useEffect(() => { setSelectedWeek(1); }, [rosterId]);

  useEffect(() => {
    if (!showProjections) return undefined;
    let cancelled = false;
    fetchRedraftValueData()
      .then(({ byName }) => {
        if (!cancelled) setRedraftByName(byName);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showProjections]);

  const luckMetrics = useMemo(() => {
    if (!showProjections) return null;
    return computeTeamLuckMetrics(
      scenarioRosters?.[rosterId] || [],
      playerProjections,
      playersData,
      playerIdMap,
      redraftByName,
    );
  }, [
    showProjections, rosterId, scenarioRosters, playerProjections,
    playersData, playerIdMap, redraftByName,
  ]);

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

  const playerScoringSection = scenarioRosters && playerWeeklyPoints ? (
    <div className="scenario-team-detail-section">
      <div className="scenario-team-detail-section-title">Player Scoring</div>
      <div className="scenario-team-detail-section-subtitle">
        Season totals, lineup usage, and HVORP
        {showProjections ? ' · ADP rolls (weeks 1–14) and independent playoff rolls (weeks 15–17)' : ' (Hwang value over replacement)'}
      </div>
      <ScenarioPlayerStatsTable
        rosterId={rosterId}
        scenarioRosters={scenarioRosters}
        scenarioWeeklyScores={scenarioWeeklyScores}
        playerWeeklyPoints={playerWeeklyPoints}
        playersData={playersData}
        playerIdMap={playerIdMap}
        onPlayerClick={setSelectedPlayer}
        playerProjections={playerProjections}
        onPercentileChange={onPercentileChange}
        onPlayoffPercentileChange={onPlayoffPercentileChange}
      />
    </div>
  ) : null;

  return (
    <div className="scenario-team-detail">
      {/* ── Header ── */}
      <div className="scenario-team-detail-header">
        <span className="scenario-team-detail-label">Viewing:</span>
        {team.avatarUrl
          ? <img className={`scenario-team-detail-avatar${mine ? ' me-avatar' : ''}`} src={team.avatarUrl} alt="" />
          : <span className={`scenario-team-detail-avatar scenario-team-detail-avatar--placeholder${mine ? ' me-avatar' : ''}`} />
        }
        <span className="scenario-team-detail-name">{team.teamName || `Team ${rosterId}`}</span>
      </div>

      {showProjections && <ScenarioLuckSummary luckMetrics={luckMetrics} />}

      {showProjections && playerScoringSection}

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
          playerProjections={playerProjections}
          onPercentileChange={onPercentileChange}
          onPlayoffPercentileChange={onPlayoffPercentileChange}
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
          teamsForGrid={teamsForGrid}
        />
      </div>

      {!showProjections && playerScoringSection}
      {selectedPlayer && createPortal(
        <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
          <div className="player-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <PlayerWeeklyScores
              player={selectedPlayer}
              onClose={() => setSelectedPlayer(null)}
              ownershipOverride={team.teamName ? { teamName: team.teamName, avatar: team.avatarUrl || null } : null}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ScenarioTeamDetail;
