import React, { useState, useMemo } from 'react';
import {
  POSITIONS,
  SCENARIOS,
  RFI,
  VS_RFI,
  handLabel,
} from '../poker/ranges';
import './PreflopPage.css';

const TABLE_SEATS = [
  { pos: 'UTG',   angle: 200 },
  { pos: 'UTG+1', angle: 235 },
  { pos: 'LJ',    angle: 270 },
  { pos: 'HJ',    angle: 305 },
  { pos: 'CO',    angle: 340 },
  { pos: 'BTN',   angle: 10 },
  { pos: 'SB',    angle: 40 },
  { pos: 'BB',    angle: 70 },
];

// Two modes: 'pick_hero' and 'pick_villain'
function PokerTable({ myPos, villainPos, pickMode, onClickSeat, validVillainPositions, showVillain }) {
  const cx = 160, cy = 110, rx = 110, ry = 65;

  return (
    <div className="preflop-table-wrap">
      <svg viewBox="0 0 320 220" className="preflop-table-svg">
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="preflop-table-felt" />
        <ellipse cx={cx} cy={cy} rx={rx - 6} ry={ry - 6} className="preflop-table-rail" />
        <text x={cx} y={cy + 4} textAnchor="middle" className="preflop-table-text">
          $1/$3
        </text>
        {TABLE_SEATS.map(({ pos, angle }) => {
          const rad = (angle * Math.PI) / 180;
          const sx = cx + (rx + 28) * Math.cos(rad);
          const sy = cy + (ry + 28) * Math.sin(rad);
          const isMy = pos === myPos;
          const isVillain = pos === villainPos;
          const isValidVillain = validVillainPositions.includes(pos);

          let cls = 'preflop-seat';
          let clickable = true;

          if (isMy) {
            cls += ' preflop-seat--my';
          } else if (isVillain) {
            cls += ' preflop-seat--villain';
          } else if (pickMode === 'pick_villain') {
            if (isValidVillain) {
              cls += ' preflop-seat--valid';
            } else {
              cls += ' preflop-seat--disabled';
              clickable = false;
            }
          }

          return (
            <g
              key={pos}
              onClick={clickable ? () => onClickSeat(pos) : undefined}
              style={{ cursor: clickable ? 'pointer' : 'default' }}
            >
              <circle cx={sx} cy={sy} r={16} className={cls} />
              <text
                x={sx} y={sy + 1}
                textAnchor="middle" dominantBaseline="middle"
                className={`preflop-seat-label${!clickable ? ' preflop-seat-label--dim' : ''}`}
              >
                {pos}
              </text>
              {isMy && (
                <text x={sx} y={sy + 12} textAnchor="middle" className="preflop-seat-you">YOU</text>
              )}
              {isVillain && (
                <text x={sx} y={sy + 12} textAnchor="middle" className="preflop-seat-villain-tag">V</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RangeStats({ grid, actionLabels, actionColors }) {
  const stats = useMemo(() => {
    if (!grid) return null;
    const counts = {};
    let total = 0;

    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const action = grid[r][c];
        const weight = r === c ? 6 : c > r ? 4 : 12;
        counts[action] = (counts[action] || 0) + weight;
        total += weight;
      }
    }

    return Object.entries(counts)
      .map(([action, count]) => ({
        action,
        label: actionLabels[action] || action,
        color: actionColors[action] || '#374151',
        pct: ((count / total) * 100).toFixed(1),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [grid, actionLabels, actionColors]);

  if (!stats) return null;

  return (
    <div className="preflop-stats">
      {stats.map(({ action, label, color, pct }) => (
        <div key={action} className="preflop-stat-item">
          <div className="preflop-stat-bar-track">
            <div
              className="preflop-stat-bar-fill"
              style={{ width: `${pct}%`, backgroundColor: color }}
            />
          </div>
          <span className="preflop-stat-label" style={{ color: action === 'F' ? '#6b7280' : color }}>
            {label}
          </span>
          <span className="preflop-stat-pct">{pct}%</span>
        </div>
      ))}
    </div>
  );
}

function HandGrid({ grid, actionColors, actionLabels }) {
  if (!grid) return <div className="preflop-no-chart">No chart for this spot.</div>;

  return (
    <div className="preflop-grid-wrapper">
      <div className="preflop-grid">
        {grid.map((row, r) =>
          row.map((action, c) => {
            const label = handLabel(r, c);
            return (
              <div
                key={`${r}-${c}`}
                className="preflop-cell"
                style={{
                  backgroundColor: actionColors[action] || '#374151',
                  color: action === 'F' ? '#6b7280' : '#fff',
                }}
                title={`${label}: ${actionLabels[action] || action}`}
              >
                <span className="preflop-cell-hand">{label}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function PreflopPage() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [myPos, setMyPos] = useState('CO');
  const [villainPos, setVillainPos] = useState('');
  // 'pick_hero' = next click moves your seat. 'pick_villain' = next click picks opponent.
  const [pickMode, setPickMode] = useState('pick_hero');

  const scenario = SCENARIOS[scenarioIdx];
  const effectiveMyPos = scenario.fixedMyPos || myPos;
  const myIdx = POSITIONS.indexOf(effectiveMyPos);

  const validVillainPositions = useMemo(() => {
    if (!scenario.needsVillainPos) return [];

    if (scenario.id === 'vs_rfi') {
      return POSITIONS.filter((pos, i) => i < myIdx && (VS_RFI[`${effectiveMyPos} vs ${pos}`] || (effectiveMyPos === 'BB' && pos === 'SB')));
    }
    if (scenario.id === 'vs_3bet') {
      return POSITIONS.filter((_, i) => i > myIdx);
    }
    if (scenario.id === 'vs_4bet') {
      return POSITIONS.filter((_, i) => i < myIdx);
    }
    return POSITIONS.filter((p) => p !== effectiveMyPos);
  }, [scenario, effectiveMyPos, myIdx]);

  const displayMeta = useMemo(() => {
    if (scenario.id === 'rfi') {
      return {
        chart: RFI[effectiveMyPos] || null,
        actionLabels: scenario.actionLabels,
        actionColors: scenario.actionColors,
        description: scenario.description,
      };
    }

    if (scenario.id === 'vs_rfi') {
      if (!villainPos) {
        return {
          chart: null,
          actionLabels: scenario.actionLabels,
          actionColors: scenario.actionColors,
          description: scenario.description,
        };
      }
      const chart = effectiveMyPos === 'BB' && villainPos === 'SB'
        ? VS_RFI['BB vs SB']
        : VS_RFI[`${effectiveMyPos} vs ${villainPos}`] || null;
      return {
        chart,
        actionLabels: scenario.actionLabels,
        actionColors: scenario.actionColors,
        description: scenario.description,
      };
    }

    return {
      chart: villainPos ? scenario.getChart(effectiveMyPos, villainPos) : null,
      actionLabels: scenario.actionLabels,
      actionColors: scenario.actionColors,
      description: scenario.description,
    };
  }, [scenario, effectiveMyPos, villainPos]);

  const { chart, actionLabels, actionColors, description } = displayMeta;

  const handleScenarioChange = (idx) => {
    setScenarioIdx(idx);
    setVillainPos('');
    setPickMode('pick_hero');
  };

  const handleClickSeat = (pos) => {
    if (pickMode === 'pick_hero') {
      setMyPos(pos);
      setVillainPos('');
      if (scenario.needsVillainPos) {
        setPickMode('pick_villain');
      }
    } else {
      // pick_villain mode
      if (pos === myPos) {
        // Clicking your own seat goes back to hero-pick mode
        setVillainPos('');
        setPickMode('pick_hero');
      } else if (validVillainPositions.includes(pos)) {
        setVillainPos(pos);
      }
    }
  };

  // For RFI (no villain needed), always stay in pick_hero mode
  const effectivePickMode = scenario.needsVillainPos ? pickMode : 'pick_hero';

  // If villain is already chosen and user taps villain seat, clear it
  const handleClickSeatWrapped = (pos) => {
    if (villainPos && pos === villainPos) {
      setVillainPos('');
      setPickMode('pick_villain');
      return;
    }
    if (villainPos && pos === myPos) {
      setVillainPos('');
      setPickMode('pick_hero');
      return;
    }
    if (villainPos && pos !== myPos && pos !== villainPos) {
      // When a chart is showing, clicking a different seat re-picks hero
      setMyPos(pos);
      setVillainPos('');
      if (scenario.needsVillainPos) {
        setPickMode('pick_villain');
      }
      return;
    }
    handleClickSeat(pos);
  };

  const promptText = useMemo(() => {
    if (scenario.fixedMyPos) return null;
    if (!scenario.needsVillainPos) return null;
    if (effectivePickMode === 'pick_hero') {
      return 'Select your seat on the table.';
    }
    if (!villainPos) {
      return 'Now pick the opponent. Tap your seat to change position.';
    }
    return `You: ${effectiveMyPos} · Opponent: ${villainPos}. Tap any seat to change.`;
  }, [scenario, effectivePickMode, villainPos, effectiveMyPos]);

  return (
    <div className="preflop-page">
      <div className="preflop-header">
        <h1>$1/$3 Preflop Guide</h1>
        <p className="preflop-subtitle">100BB · Jonathan Little's Ranges</p>
      </div>

      <div className="preflop-controls">
        <div className="preflop-control-group">
          <label className="preflop-label">Scenario</label>
          <div className="preflop-scenario-btns">
            {SCENARIOS.map((s, i) => (
              <button
                key={s.id}
                className={`preflop-scenario-btn${i === scenarioIdx ? ' preflop-scenario-btn--active' : ''}`}
                onClick={() => handleScenarioChange(i)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="preflop-desc">{description}</p>

      {!scenario.fixedMyPos && (
        <PokerTable
          myPos={myPos}
          villainPos={villainPos}
          pickMode={effectivePickMode}
          onClickSeat={handleClickSeatWrapped}
          validVillainPositions={validVillainPositions}
          showVillain={scenario.needsVillainPos}
        />
      )}

      {promptText && (
        <p className="preflop-prompt">{promptText}</p>
      )}

      <RangeStats
        grid={chart}
        actionLabels={actionLabels}
        actionColors={actionColors}
      />

      <HandGrid
        grid={chart}
        actionColors={actionColors}
        actionLabels={actionLabels}
      />

      <div className="preflop-legend">
        {Object.entries(actionLabels).map(([key, label]) => (
          <div key={key} className="preflop-legend-item">
            <span
              className="preflop-legend-swatch"
              style={{ backgroundColor: actionColors[key] }}
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
