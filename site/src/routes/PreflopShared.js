import React, { createContext, useContext, useMemo } from 'react';
import { handLabel } from '../poker/ranges';

const LowWifiContext = createContext(false);

export function LowWifiProvider({ value, children }) {
  return <LowWifiContext.Provider value={Boolean(value)}>{children}</LowWifiContext.Provider>;
}

export function useLowWifi() {
  return useContext(LowWifiContext);
}

function handFromCards(cards) {
  if (!cards || cards.length < 2) return '';
  const toRank = rank => (rank === '10' ? 'T' : rank);
  const r1 = toRank(cards[0].rank);
  const r2 = toRank(cards[1].rank);
  const order = 'AKQJT98765432';
  const i1 = order.indexOf(r1);
  const i2 = order.indexOf(r2);
  const high = i1 <= i2 ? r1 : r2;
  const low = i1 <= i2 ? r2 : r1;
  if (high === low) return `${high}${low}`;
  return `${high}${low}${cards[0].suit === cards[1].suit ? 's' : 'o'}`;
}

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

export function HoleCards({ cards, hand, size = 'lg' }) {
  const lowWifi = useLowWifi();
  const label = hand || handFromCards(cards);
  if (!cards?.length && !label) return null;
  if (lowWifi) {
    return <div className={`hole-cards-text hole-cards-text--${size}`}>{label}</div>;
  }
  if (!cards?.length) return <div className={`hole-cards-text hole-cards-text--${size}`}>{label}</div>;
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
  hand,
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
          <HoleCards cards={holeCards} hand={hand} size="lg" />
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

export function HandGrid({ grid, actionColors, actionLabels, highlightHand, reachMask }) {
  if (!grid) return <div className="preflop-no-chart">No chart for this spot.</div>;

  const hasUnreached = Boolean(reachMask?.some(row => row.some(reached => !reached)));
  const foldColor = hasUnreached ? '#3b82f6' : (actionColors.F || '#374151');

  return (
    <div className="preflop-grid-wrapper">
      <div className="preflop-grid">
        {grid.map((row, r) =>
          row.map((action, c) => {
            const label = handLabel(r, c);
            const highlighted = highlightHand === label;
            const reached = !reachMask || reachMask[r][c];
            const isFold = reached && action === 'F';
            return (
              <div
                key={`${r}-${c}`}
                className={`preflop-cell${highlighted ? ' preflop-cell--highlight' : ''}${reached ? '' : ' preflop-cell--unreached'}`}
                style={reached ? {
                  backgroundColor: isFold ? foldColor : (actionColors[action] || '#374151'),
                  color: isFold ? '#dbeafe' : (action === 'F' ? '#6b7280' : '#fff'),
                } : undefined}
                title={reached
                  ? `${label}: ${actionLabels[action] || action}`
                  : `${label}: folded earlier — not in this spot`}
              >
                <span className="preflop-cell-hand">{label}</span>
              </div>
            );
          })
        )}
      </div>
      {hasUnreached && (
        <div className="preflop-legend preflop-legend--grid">
          <div className="preflop-legend-item">
            <span className="preflop-legend-swatch" style={{ backgroundColor: foldColor }} />
            Fold here
          </div>
          <div className="preflop-legend-item">
            <span className="preflop-legend-swatch preflop-legend-swatch--unreached" />
            Folded earlier
          </div>
        </div>
      )}
    </div>
  );
}

export { TABLE_SEATS };

export function ActionButtons({ chart, actionLabels, actionColors, disabled, selected, onPick }) {
  const present = new Set();
  if (chart) {
    for (const row of chart) {
      for (const action of row) present.add(action);
    }
  }
  const unique = [];
  const seen = new Set();
  for (const key of Object.keys(actionLabels)) {
    if (!present.has(key)) continue;
    const label = actionLabels[key];
    if (seen.has(label)) continue;
    seen.add(label);
    unique.push(key);
  }

  return (
    <div className="preflop-quiz-actions">
      {unique.map(key => {
        const color = key === 'F' ? '#94a3b8' : (actionColors[key] || '#94a3b8');
        const picked = selected === key;
        return (
          <button
            key={key}
            className={`preflop-quiz-action${picked ? ' preflop-quiz-action--picked' : ''}`}
            style={{
              borderColor: color,
              color: picked ? '#0f172a' : color,
              background: picked ? color : 'transparent',
            }}
            disabled={disabled}
            onClick={() => onPick(key)}
          >
            {actionLabels[key]}
          </button>
        );
      })}
    </div>
  );
}
