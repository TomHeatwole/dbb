import React, { useMemo } from 'react';
import { handLabel } from '../poker/ranges';

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

const SUIT_MARKS = {
  s: { pip: '♠', red: false },
  h: { pip: '♥', red: true },
  d: { pip: '♦', red: true },
  c: { pip: '♣', red: false },
};

export function PlayingCard({ rank, suit, size = 'md' }) {
  const mark = SUIT_MARKS[suit] || SUIT_MARKS.s;
  return (
    <div className={`playing-card playing-card--${size}${mark.red ? ' playing-card--red' : ' playing-card--black'}`}>
      <span className="playing-card-corner playing-card-corner--tl">
        <span>{rank}</span>
        <span>{mark.pip}</span>
      </span>
      <span className="playing-card-pip">{mark.pip}</span>
      <span className="playing-card-corner playing-card-corner--br">
        <span>{rank}</span>
        <span>{mark.pip}</span>
      </span>
    </div>
  );
}

export function HoleCards({ cards, size = 'lg' }) {
  if (!cards?.length) return null;
  return (
    <div className={`hole-cards hole-cards--${size}`}>
      {cards.map((card, i) => (
        <PlayingCard key={`${card.rank}${card.suit}${i}`} rank={card.rank} suit={card.suit} size={size} />
      ))}
    </div>
  );
}

export function PokerTable({
  myPos,
  villainPos,
  pickMode,
  onClickSeat,
  validVillainPositions,
  interactive = true,
  holeCards,
}) {
  const cx = 160, cy = 110, rx = 110, ry = 65;

  return (
    <div className="preflop-table-wrap">
      <svg viewBox="0 0 320 220" className="preflop-table-svg">
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="preflop-table-felt" />
        <ellipse cx={cx} cy={cy} rx={rx - 6} ry={ry - 6} className="preflop-table-rail" />
        <text x={cx} y={cy + 4} textAnchor="middle" className="preflop-table-text">
          {holeCards ? '' : '$1/$3'}
        </text>
        {TABLE_SEATS.map(({ pos, angle }) => {
          const rad = (angle * Math.PI) / 180;
          const sx = cx + (rx + 28) * Math.cos(rad);
          const sy = cy + (ry + 28) * Math.sin(rad);
          const isMy = pos === myPos;
          const isVillain = pos === villainPos;
          const isValidVillain = validVillainPositions.includes(pos);

          let cls = 'preflop-seat';
          let clickable = interactive;

          if (isMy) {
            cls += ' preflop-seat--my';
          } else if (isVillain) {
            cls += ' preflop-seat--villain';
          } else if (interactive && pickMode === 'pick_villain') {
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
                className={`preflop-seat-label${!clickable && interactive ? ' preflop-seat-label--dim' : ''}`}
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
      {holeCards && (
        <div className="preflop-table-hole">
          <HoleCards cards={holeCards} size="lg" />
        </div>
      )}
    </div>
  );
}

export function RangeStats({ grid, actionLabels, actionColors }) {
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

export function HandGrid({ grid, actionColors, actionLabels, highlightHand }) {
  if (!grid) return <div className="preflop-no-chart">No chart for this spot.</div>;

  return (
    <div className="preflop-grid-wrapper">
      <div className="preflop-grid">
        {grid.map((row, r) =>
          row.map((action, c) => {
            const label = handLabel(r, c);
            const highlighted = highlightHand === label;
            return (
              <div
                key={`${r}-${c}`}
                className={`preflop-cell${highlighted ? ' preflop-cell--highlight' : ''}`}
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

export { TABLE_SEATS };
